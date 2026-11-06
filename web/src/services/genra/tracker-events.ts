// Event shapes for the canvas analytics. Pure, so they can be unit-tested; tracker.ts sends them.
// Wire format is the main site's track() protocol: video_mvp auth/supabase/functions/track-event, which rejects
// any event name missing from its whitelist.
import { inferMediaScale } from "@/lib/media-size";

export type CanvasEventName = "canvas_open" | "canvas_generate" | "canvas_generate_done" | "canvas_sync_error" | "canvas_upgrade_click";

export type TrackIds = { eventId: string; sessionId: string; anonymousId: string };
export type TrackPage = { pageUrl: string; userAgent: string; viewportWidth?: number; viewportHeight?: number };

const SENSITIVE_QUERY_KEYS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token", "id_token", "token", "code"];

/** Same scrubbing as the main site: OAuth callbacks put tokens in the hash or query, and those must never be stored. */
export function sanitizePageUrl(href: string) {
    try {
        const url = new URL(href);
        url.hash = "";
        SENSITIVE_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
        return url.toString();
    } catch {
        return "";
    }
}

export function buildTrackBody(eventName: CanvasEventName, eventData: Record<string, unknown>, ids: TrackIds, page: TrackPage) {
    return {
        event_id: ids.eventId,
        session_id: ids.sessionId,
        anonymous_id: ids.anonymousId,
        event_name: eventName,
        event_data: { app: "canvas", ...eventData },
        page_url: sanitizePageUrl(page.pageUrl),
        user_agent: page.userAgent,
        ...(page.viewportWidth ? { viewport_width: page.viewportWidth, viewport_height: page.viewportHeight } : {}),
    };
}

export type GenerationRequest = {
    capability: "image" | "video";
    model: string;
    n: number;
    /** Video only: the tier sent, such as "480p". */
    resolution?: string;
    /** Image only: the size class, such as "1k". */
    image_size?: string;
    seconds?: number;
    size?: string;
};

type FieldReader = (key: string) => string | undefined;

function fieldsOf(body: unknown): FieldReader {
    if (typeof FormData !== "undefined" && body instanceof FormData) return (key) => (typeof body.get(key) === "string" ? (body.get(key) as string) : undefined);
    let data = body;
    if (typeof body === "string") {
        try {
            data = JSON.parse(body);
        } catch {
            data = null;
        }
    }
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return (key) => (record[key] === undefined || record[key] === null ? undefined : String(record[key]));
}

/** Recognises an image or video submit to the facade and reads what is being generated. */
export function describeGenerationRequest(method: string | undefined, url: string | undefined, body: unknown): GenerationRequest | null {
    if ((method ?? "get").toLowerCase() !== "post" || !url) return null;
    const path = url.split("?")[0];
    const capability = /\/v1\/images\/(generations|edits)$/.test(path) ? "image" : /\/v1\/videos$/.test(path) ? "video" : null;
    if (!capability) return null;
    const field = fieldsOf(body);
    const model = field("model");
    if (!model) return null;
    const size = field("size");
    const n = Math.max(1, Number(field("n")) || 1);
    if (capability === "image") return { capability, model, n, ...(size ? { size, image_size: inferMediaScale(size) } : {}) };
    const seconds = Number(field("seconds"));
    const resolution = field("resolution_name") ?? field("resolution");
    return { capability, model, n, ...(seconds > 0 ? { seconds } : {}), ...(resolution ? { resolution } : {}), ...(size ? { size } : {}) };
}

/** Best stable error code for analytics: the API's code when there is one, otherwise the status or a transport label. */
export function errorCodeOf(status: number | undefined, body: unknown, fallback = "error") {
    const data = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {};
    const nested = data.error && typeof data.error === "object" ? (data.error as { code?: unknown }).code : undefined;
    const code = nested ?? (typeof data.error === "string" ? data.error : undefined) ?? data.code;
    // Only code-like strings: some failures put a whole sentence in `error`, which would split the metric by wording.
    if (typeof code === "string" && /^[a-z][a-z0-9_.-]{0,63}$/i.test(code)) return code;
    return status ? `http_${status}` : fallback;
}
