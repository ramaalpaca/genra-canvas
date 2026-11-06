// Canvas analytics over the main site's track-event function. Fire and forget: nothing waits on it and every failure
// is swallowed. Only canvas.genra.ai sends, so local development doesn't land in production data.
import axios, { type InternalAxiosRequestConfig } from "axios";

import { getGenraAccessToken } from "./auth";
import { GENRA_API_URL, GENRA_SUPABASE_URL } from "./env";
import { isFreeUser } from "./free-tier";
import { estimateCost } from "./pricing";
import { buildTrackBody, describeGenerationRequest, errorCodeOf, type CanvasEventName, type GenerationRequest } from "./tracker-events";

const ANONYMOUS_ID_KEY = "genra_anonymous_id";
const SESSION_ID_KEY = "genra_session_id";
const OPEN_DEDUPE_MS = 60_000;

const randomPart = () => Math.random().toString(36).slice(2, 11);

function storedId(storage: () => Storage, key: string, prefix: string) {
    try {
        const existing = storage().getItem(key);
        if (existing) return existing;
        const created = `${prefix}_${Date.now()}_${randomPart()}`;
        storage().setItem(key, created);
        return created;
    } catch {
        return `${prefix}_${Date.now()}_${randomPart()}`;
    }
}

function trackingEnabled() {
    return typeof window !== "undefined" && window.location.hostname.endsWith("genra.ai") && Boolean(GENRA_SUPABASE_URL);
}

/** Sends one event. The user's token, when there is one, lets the function attach the user id. */
export function track(eventName: CanvasEventName, eventData: Record<string, unknown> = {}) {
    if (!trackingEnabled()) return;
    try {
        const body = buildTrackBody(
            eventName,
            { user_tier: isFreeUser() ? "free" : "paid", ...eventData },
            { eventId: crypto.randomUUID(), sessionId: storedId(() => sessionStorage, SESSION_ID_KEY, "sess"), anonymousId: storedId(() => localStorage, ANONYMOUS_ID_KEY, "anon") },
            { pageUrl: window.location.href, userAgent: navigator.userAgent, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight },
        );
        const token = getGenraAccessToken();
        void fetch(`${GENRA_SUPABASE_URL}/functions/v1/track-event`, {
            method: "POST",
            // keepalive so an event sent while leaving the page still arrives.
            keepalive: true,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        }).catch(() => undefined);
    } catch {
        // Analytics must never break the canvas.
    }
}

const recentOpens = new Map<string, number>();

/** The canvas page reloads a project after cloud sync, so a repeat within a minute is the same visit. */
export function trackCanvasOpen(surface: "list" | "canvas", data: { project_id?: string; node_count?: number; project_count?: number }) {
    const key = `${surface}:${data.project_id ?? ""}`;
    if (Date.now() - (recentOpens.get(key) ?? 0) < OPEN_DEDUPE_MS) return;
    recentOpens.set(key, Date.now());
    track("canvas_open", { surface, ...data });
}

/** `action` separates clicking something locked from pressing the upgrade button itself. */
export function trackUpgradeClick(action: "locked_model" | "locked_resolution" | "locked_image_size" | "upgrade_button") {
    track("canvas_upgrade_click", { action });
}

let lastSyncError: string | null = null;

/** Once per failure streak: sync retries with backoff, and each retry is not news. */
export function trackSyncError(error: unknown, failures: number) {
    if (failures > 1 && lastSyncError) return;
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.name : "unknown";
    lastSyncError = code;
    track("canvas_sync_error", { error: code, message: error instanceof Error ? error.message.slice(0, 200) : undefined });
}

export function resetSyncErrorStreak() {
    lastSyncError = null;
}

type PendingGeneration = GenerationRequest & { startedAt: number; estimated_credits?: number };
type TrackedConfig = InternalAxiosRequestConfig & { genraGeneration?: PendingGeneration };
const pendingVideos = new Map<string, PendingGeneration>();

function generationData({ startedAt: _startedAt, ...generation }: PendingGeneration) {
    return generation;
}

function finishGeneration(generation: PendingGeneration, outcome: { success: boolean; credits_cost?: number; error_code?: string }) {
    track("canvas_generate_done", { ...generationData(generation), ...outcome, duration_ms: Date.now() - generation.startedAt });
}

const genraCost = (data: unknown) => {
    const cost = (data as { genra?: { credits_cost?: unknown } } | null)?.genra?.credits_cost;
    return typeof cost === "number" ? cost : undefined;
};

/** Watches facade requests, so generation analytics needs no change at the upstream call sites. */
export function startCanvasTracking() {
    axios.interceptors.request.use((config: TrackedConfig) => {
        if (!config.url?.startsWith(GENRA_API_URL)) return config;
        const request = describeGenerationRequest(config.method, config.url, config.data);
        if (!request) return config;
        const estimated = estimateCost(request.model, { count: request.n, seconds: request.seconds, resolution: request.resolution ?? request.size });
        const generation: PendingGeneration = { ...request, startedAt: Date.now(), ...(estimated === undefined ? {} : { estimated_credits: estimated }) };
        config.genraGeneration = generation;
        track("canvas_generate", generationData(generation));
        return config;
    });
    axios.interceptors.response.use(
        (response) => {
            const generation = (response.config as TrackedConfig).genraGeneration;
            const data = response.data as { id?: unknown; status?: unknown; error?: unknown } | null;
            if (generation?.capability === "image") finishGeneration(generation, { success: true, credits_cost: genraCost(data) });
            else if (generation?.capability === "video" && typeof data?.id === "string") pendingVideos.set(data.id, generation);
            else if (typeof data?.id === "string" && pendingVideos.has(data.id) && (data.status === "completed" || data.status === "failed")) {
                // Videos finish later: the poll that reports a final status closes the event.
                const pending = pendingVideos.get(data.id)!;
                pendingVideos.delete(data.id);
                finishGeneration(pending, data.status === "completed" ? { success: true, credits_cost: genraCost(data) } : { success: false, error_code: errorCodeOf(undefined, data, "failed") });
            }
            return response;
        },
        (error: unknown) => {
            const generation = axios.isAxiosError(error) ? (error.config as TrackedConfig | undefined)?.genraGeneration : undefined;
            if (generation && axios.isAxiosError(error)) {
                const code = axios.isCancel(error) ? "canceled" : error.response ? errorCodeOf(error.response.status, error.response.data) : "network_error";
                finishGeneration(generation, { success: false, error_code: code });
            }
            throw error;
        },
    );
}
