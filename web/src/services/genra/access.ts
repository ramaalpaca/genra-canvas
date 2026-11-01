// Canvas allowlist state. Checked once per sign-in and held in memory only, so a reload always asks the server again.
import axios from "axios";
import { create } from "zustand";

import { getGenraAccessToken, redirectToGenraLogin, supabase, useGenraAuth } from "./auth";
import { checkCanvasAccess, isCanvasNotEnabledBody, withCanvasDenialCheck, type CanvasAccessMode } from "./access-client";
import { GENRA_ACCESS_GATE_ENABLED, GENRA_API_URL } from "./env";

/** `unreachable` means we could not find out, so the canvas stays closed but no one is told they lack access. */
export type CanvasAccessStatus = "checking" | "enabled" | "disabled" | "unreachable";

export const useCanvasAccess = create<{ status: CanvasAccessStatus; mode: CanvasAccessMode | null }>()(() => ({ status: GENRA_ACCESS_GATE_ENABLED ? "checking" : "enabled", mode: null }));

export const isCanvasAccessEnabled = () => useCanvasAccess.getState().status === "enabled";

/** Newest check wins, and a denial from a live request outranks any answer still in flight. */
let generation = 0;

export async function recheckCanvasAccess(allowTokenRefresh = true): Promise<void> {
    generation += 1;
    const current = generation;
    useCanvasAccess.setState({ status: "checking" });
    const result = await checkCanvasAccess({ url: `${GENRA_API_URL}/api/v1/canvas/access`, token: getGenraAccessToken() });
    if (current !== generation) return;
    if (result.status === "unauthorized") {
        if (allowTokenRefresh) {
            const { error } = await supabase.auth.refreshSession();
            if (current === generation && !error) return recheckCanvasAccess(false);
        }
        // Clear this browser only, so one bad token doesn't sign the user out everywhere. Without it the main site would
        // see the shared cookie and bounce straight back here. Status stays "checking" while the browser leaves.
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        return redirectToGenraLogin();
    }
    useCanvasAccess.setState({ status: result.status, mode: "mode" in result ? result.mode : null });
}

function denyCanvasAccess() {
    generation += 1;
    useCanvasAccess.setState({ status: "disabled" });
}

function watchForDenial() {
    window.fetch = withCanvasDenialCheck(window.fetch.bind(window), denyCanvasAccess);
    axios.interceptors.response.use(undefined, async (error: unknown) => {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
            const { data } = error.response;
            if (isCanvasNotEnabledBody(data instanceof Blob ? await data.text() : data)) denyCanvasAccess();
        }
        throw error;
    });
}

/** App bootstrap, before anything sends a request. */
export function startCanvasAccess() {
    if (!GENRA_ACCESS_GATE_ENABLED) return;
    watchForDenial();
    let userId: string | null = null;
    const update = () => {
        const next = useGenraAuth.getState().user?.id ?? null;
        if (next === userId) return;
        userId = next;
        if (next) {
            void recheckCanvasAccess();
        } else {
            generation += 1;
            useCanvasAccess.setState({ status: "checking", mode: null });
        }
    };
    useGenraAuth.subscribe(update);
    update();
}
