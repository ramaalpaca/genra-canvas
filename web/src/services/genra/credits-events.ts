// Watches generation requests for charges and "out of credits" so no upstream call site has to know about credits.
import axios from "axios";
import { create } from "zustand";

import i18n from "@/i18n";

import { hasErrorCode } from "./access-client";
import { GENRA_API_URL } from "./env";
import { PAID_PLAN_REQUIRED } from "./free-tier";
import { readCreditsCharge } from "./pricing";

const CHARGE_BATCH_MS = 1_500;
const INSUFFICIENT_NOTICE_COOLDOWN_MS = 10_000;

type CreditsEvents = {
    /** One toast per batch: a 3-image run is three requests but one thing the user did. */
    charge: { cost: number; balance?: number; sequence: number } | null;
    insufficientSequence: number;
    upgradeSequence: number;
};

export const useCreditsEvents = create<CreditsEvents>()(() => ({ charge: null, insufficientSequence: 0, upgradeSequence: 0 }));

let pending: { cost: number; balance?: number } | null = null;
let batchTimer: ReturnType<typeof setTimeout> | undefined;
let lastInsufficientAt = 0;
const chargedIds = new Set<string>();

function recordCharge(body: unknown) {
    const charge = readCreditsCharge(body);
    if (!charge) return;
    if (charge.id) {
        // A finished video can be fetched again, for example after a page reload resumes its polling.
        if (chargedIds.has(charge.id)) return;
        chargedIds.add(charge.id);
    }
    // Concurrent responses can arrive out of order, and balances only go down, so the smallest is the latest.
    const balances = [pending?.balance, charge.balance].filter((value): value is number => value !== undefined);
    pending = { cost: (pending?.cost ?? 0) + charge.cost, ...(balances.length ? { balance: Math.min(...balances) } : {}) };
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
        const batch = pending;
        pending = null;
        if (batch) useCreditsEvents.setState((state) => ({ charge: { ...batch, sequence: (state.charge?.sequence ?? 0) + 1 } }));
    }, CHARGE_BATCH_MS);
}

function noticeInsufficient() {
    if (Date.now() - lastInsufficientAt < INSUFFICIENT_NOTICE_COOLDOWN_MS) return;
    lastInsufficientAt = Date.now();
    useCreditsEvents.setState((state) => ({ insufficientSequence: state.insufficientSequence + 1 }));
}

/** Asks a free user to upgrade: a locked option was clicked, or the server refused a request. */
export function promptUpgrade() {
    useCreditsEvents.setState((state) => ({ upgradeSequence: state.upgradeSequence + 1 }));
}

const paidPlanBody = () => ({ error: { message: i18n.t("genra.pricing.paidPlanError"), type: "paid_plan_required", code: PAID_PLAN_REQUIRED, param: null } });

const insufficientBody = () => ({ error: { message: i18n.t("genra.pricing.insufficientError"), type: "insufficient_credits", code: "insufficient_credits", param: null } });

/** Generation errors surface the server's message as-is, so swap the text here for every caller at once. */
function watchFetch() {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const response = await original(...args);
        if (!response.url.startsWith(GENRA_API_URL)) return response;
        const headers = { "Content-Type": "application/json" };
        if (response.status === 402) {
            noticeInsufficient();
            return new Response(JSON.stringify(insufficientBody()), { status: 402, headers });
        }
        if (response.status !== 403 || !hasErrorCode(await response.clone().text(), PAID_PLAN_REQUIRED)) return response;
        promptUpgrade();
        return new Response(JSON.stringify(paidPlanBody()), { status: 403, headers });
    };
}

export function startCreditsTracking() {
    watchFetch();
    axios.interceptors.response.use(
        (response) => {
            if (response.config.url?.startsWith(GENRA_API_URL)) recordCharge(response.data);
            return response;
        },
        async (error: unknown) => {
            if (!axios.isAxiosError(error) || !error.response || !error.config?.url?.startsWith(GENRA_API_URL)) throw error;
            const { response } = error;
            if (response.status === 402) {
                response.data = insufficientBody();
                noticeInsufficient();
            } else if (response.status === 403 && hasErrorCode(response.data instanceof Blob ? await response.data.text() : response.data, PAID_PLAN_REQUIRED)) {
                response.data = paidPlanBody();
                promptUpgrade();
            }
            throw error;
        },
    );
}
