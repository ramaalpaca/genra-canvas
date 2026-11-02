// Canvas allowlist: asks the backend whether this account may use the canvas, and recognises the "access removed" error.
// Kept free of app state so the rules can be tested with a mock fetch; access.ts wires them into the app.

export const CANVAS_NOT_ENABLED = "canvas_not_enabled";

export type CanvasAccessMode = "beta" | "all";
export type CanvasAccessResult = { status: "enabled" | "disabled"; mode: CanvasAccessMode } | { status: "unauthorized" } | { status: "unreachable" };

/** The canvas API, the OpenAI facade and FastAPI wrap errors differently, so accept each shape the code can arrive in. */
export function isCanvasNotEnabledBody(value: unknown): boolean {
    if (typeof value === "string") {
        if (value === CANVAS_NOT_ENABLED) return true;
        try {
            return isCanvasNotEnabledBody(JSON.parse(value));
        } catch {
            return false;
        }
    }
    if (!value || typeof value !== "object") return false;
    const body = value as Record<string, unknown>;
    return [body.code, body.error, body.detail].some((field) => field === CANVAS_NOT_ENABLED || (typeof field === "object" && isCanvasNotEnabledBody(field)));
}

export async function checkCanvasAccess({ url, token, fetchImpl }: { url: string; token: string; fetchImpl?: typeof fetch }): Promise<CanvasAccessResult> {
    let response: Response;
    try {
        response = await (fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
        return { status: "unreachable" };
    }
    if (response.status === 401) return { status: "unauthorized" };
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 403 && isCanvasNotEnabledBody(body)) return { status: "disabled", mode: "beta" };
    if (!response.ok || typeof (body as { enabled?: unknown } | null)?.enabled !== "boolean") return { status: "unreachable" };
    const { enabled, mode } = body as { enabled: boolean; mode?: string };
    return { status: enabled ? "enabled" : "disabled", mode: mode === "all" ? "all" : "beta" };
}

/** Wraps fetch so a 403 canvas_not_enabled from anywhere is noticed. The caller still gets the response, body unread. */
export function withCanvasDenialCheck(fetchImpl: typeof fetch, onDenied: () => void): typeof fetch {
    return async (...args) => {
        const response = await fetchImpl(...args);
        if (response.status === 403) {
            void response
                .clone()
                .text()
                .then((text) => {
                    if (isCanvasNotEnabledBody(text)) onDenied();
                })
                .catch(() => undefined);
        }
        return response;
    };
}
