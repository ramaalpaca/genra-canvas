import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import axios, { type AxiosAdapter } from "axios";

import { buildTrackBody, describeGenerationRequest, errorCodeOf, sanitizePageUrl } from "../src/services/genra/tracker-events";

describe("event shapes", () => {
    test("a track body matches the main site's track-event protocol", () => {
        const body = buildTrackBody(
            "canvas_open",
            { surface: "canvas", project_id: "p1", node_count: 4 },
            { eventId: "e1", sessionId: "sess_1_a", anonymousId: "anon_1_a" },
            { pageUrl: "https://canvas.genra.ai/canvas/p1", userAgent: "UA", viewportWidth: 1280, viewportHeight: 800 },
        );
        expect(body).toEqual({
            event_id: "e1",
            session_id: "sess_1_a",
            anonymous_id: "anon_1_a",
            event_name: "canvas_open",
            event_data: { app: "canvas", surface: "canvas", project_id: "p1", node_count: 4 },
            page_url: "https://canvas.genra.ai/canvas/p1",
            user_agent: "UA",
            viewport_width: 1280,
            viewport_height: 800,
        });
    });

    test("tokens and OAuth codes never reach the page url", () => {
        expect(sanitizePageUrl("https://canvas.genra.ai/canvas?code=abc&lang=zh#access_token=x")).toBe("https://canvas.genra.ai/canvas?lang=zh");
        expect(sanitizePageUrl("not a url")).toBe("");
    });
});

describe("describeGenerationRequest", () => {
    const base = "https://backend.genra.ai/openai/v1";

    test("image generation from JSON", () => {
        expect(describeGenerationRequest("post", `${base}/images/generations`, JSON.stringify({ model: "nano-banana-2", n: 2, size: "1536x864" }))).toEqual({ capability: "image", model: "nano-banana-2", n: 2, size: "1536x864", image_size: "1k" });
    });

    test("image edit from multipart", () => {
        const form = new FormData();
        form.append("model", "nano-banana-pro");
        form.append("size", "2048x2048");
        form.append("image", new Blob(["x"]), "a.png");
        expect(describeGenerationRequest("POST", `${base}/images/edits`, form)).toEqual({ capability: "image", model: "nano-banana-pro", n: 1, size: "2048x2048", image_size: "2k" });
    });

    test("video submit from multipart", () => {
        const form = new FormData();
        form.append("model", "seedance-v2-mini");
        form.append("seconds", "6");
        form.append("size", "854x480");
        form.append("resolution_name", "480p");
        expect(describeGenerationRequest("post", `${base}/videos`, form)).toEqual({ capability: "video", model: "seedance-v2-mini", n: 1, seconds: 6, resolution: "480p", size: "854x480" });
    });

    test("ignores everything that is not a generation submit", () => {
        expect(describeGenerationRequest("get", `${base}/videos`, null)).toBeNull();
        expect(describeGenerationRequest("get", `${base}/videos/task-1`, null)).toBeNull();
        expect(describeGenerationRequest("post", `${base}/responses`, JSON.stringify({ model: "genra-text" }))).toBeNull();
        expect(describeGenerationRequest("post", `${base}/images/generations`, JSON.stringify({ prompt: "no model" }))).toBeNull();
    });

    test("error codes come from the API, then the status", () => {
        expect(errorCodeOf(402, { error: { code: "insufficient_credits", message: "…" } })).toBe("insufficient_credits");
        expect(errorCodeOf(403, { error: "canvas_not_enabled" })).toBe("canvas_not_enabled");
        expect(errorCodeOf(500, "<html>")).toBe("http_500");
        expect(errorCodeOf(undefined, { error: "The provider timed out after 600 seconds" }, "failed")).toBe("failed");
    });
});

describe("tracker", () => {
    const sent: { url: string; headers: Record<string, string>; body: Record<string, any> }[] = [];
    let tracker: typeof import("../src/services/genra/tracker");
    let freeTier: typeof import("../src/services/genra/free-tier");
    let pricing: typeof import("../src/services/genra/pricing");

    beforeAll(async () => {
        process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
        process.env.VITE_SUPABASE_ANON_KEY = "test";
        const memory = () => {
            const values = new Map<string, string>();
            return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
        };
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory() });
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: memory() });
        Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hostname: "canvas.genra.ai", href: "https://canvas.genra.ai/canvas/p1" }, innerWidth: 1280, innerHeight: 800 } });
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "UA", onLine: true } });
        globalThis.fetch = (async (url: string, init: RequestInit) => {
            sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
            return new Response("{}");
        }) as unknown as typeof fetch;
        tracker = await import("../src/services/genra/tracker");
        freeTier = await import("../src/services/genra/free-tier");
        pricing = await import("../src/services/genra/pricing");
        tracker.startCanvasTracking();
    });

    afterEach(() => {
        sent.length = 0;
    });

    // Other test files assume no browser globals (i18n, for one, reads window when it exists).
    const originalFetch = globalThis.fetch;
    afterAll(() => {
        for (const key of ["window", "navigator", "sessionStorage"]) Reflect.deleteProperty(globalThis, key);
        globalThis.fetch = originalFetch;
    });

    test("posts to the track-event function with ids the function accepts and the user tier", () => {
        freeTier.setFreeTierCatalog("free", []);
        tracker.track("canvas_upgrade_click", { action: "upgrade_button" });
        const [{ url, body }] = sent;
        expect(url).toBe("https://test.supabase.co/functions/v1/track-event");
        expect(body.anonymous_id).toStartWith("anon_");
        expect(body.anonymous_id.length).toBeLessThanOrEqual(50);
        expect(body.session_id).toStartWith("sess_");
        expect(body.event_data).toEqual({ app: "canvas", user_tier: "free", action: "upgrade_button" });
    });

    test("ids stay stable across events", () => {
        tracker.track("canvas_open", {});
        tracker.track("canvas_open", {});
        expect(sent[0].body.anonymous_id).toBe(sent[1].body.anonymous_id);
        expect(sent[0].body.session_id).toBe(sent[1].body.session_id);
        expect(sent[0].body.event_id).not.toBe(sent[1].body.event_id);
    });

    test("the same canvas opened again within a minute counts once", () => {
        tracker.trackCanvasOpen("canvas", { project_id: "p-dedupe", node_count: 3 });
        tracker.trackCanvasOpen("canvas", { project_id: "p-dedupe", node_count: 3 });
        tracker.trackCanvasOpen("canvas", { project_id: "p-other", node_count: 0 });
        expect(sent.map((item) => item.body.event_data.project_id)).toEqual(["p-dedupe", "p-other"]);
        expect(sent[0].body.event_data).toMatchObject({ surface: "canvas", node_count: 3 });
    });

    test("a sync failure streak is reported once, and again after recovering", () => {
        const error = Object.assign(new Error("Failed to fetch"), { code: "network_error" });
        tracker.trackSyncError(error, 1);
        tracker.trackSyncError(error, 2);
        tracker.trackSyncError(error, 3);
        tracker.resetSyncErrorStreak();
        tracker.trackSyncError(error, 1);
        expect(sent.map((item) => item.body.event_name)).toEqual(["canvas_sync_error", "canvas_sync_error"]);
        expect(sent[0].body.event_data).toMatchObject({ error: "network_error", message: "Failed to fetch" });
    });

    const reply =
        (status: number, data: unknown): AxiosAdapter =>
        async (config) => {
            const response = { data, status, statusText: "", headers: {}, config };
            if (status >= 400) throw new axios.AxiosError("failed", "ERR_BAD_RESPONSE", config, null, response);
            return response;
        };

    test("an image generation sends a submit and a done event", async () => {
        freeTier.setFreeTierCatalog("paid", []);
        pricing.setModelCatalog([{ name: "nano-banana-2", pricing: { per_unit: 1 } }]);
        await axios.post("https://backend.genra.ai/openai/v1/images/generations", { model: "nano-banana-2", n: 2, size: "1024x1024" }, { adapter: reply(200, { data: [], genra: { credits_cost: 2, credits_balance: 98 } }) });
        const [submit, done] = sent.map((item) => item.body);
        expect(submit.event_name).toBe("canvas_generate");
        expect(submit.event_data).toEqual({ app: "canvas", user_tier: "paid", capability: "image", model: "nano-banana-2", n: 2, size: "1024x1024", image_size: "1k", estimated_credits: 2 });
        expect(done.event_name).toBe("canvas_generate_done");
        expect(done.event_data).toMatchObject({ capability: "image", model: "nano-banana-2", success: true, credits_cost: 2 });
        expect(done.event_data.duration_ms).toBeGreaterThanOrEqual(0);
    });

    test("a refused generation reports its error code", async () => {
        await axios.post("https://backend.genra.ai/openai/v1/images/generations", { model: "nano-banana-pro" }, { adapter: reply(403, { error: { code: "paid_plan_required" } }) }).catch(() => undefined);
        expect(sent[1].body.event_data).toMatchObject({ success: false, error_code: "paid_plan_required" });
    });

    test("a video is done when a poll reports its final status, once", async () => {
        const form = new FormData();
        form.append("model", "seedance-v2-mini");
        form.append("seconds", "6");
        form.append("resolution_name", "480p");
        await axios.post("https://backend.genra.ai/openai/v1/videos", form, { adapter: reply(200, { id: "task-1", status: "queued" }) });
        expect(sent.map((item) => item.body.event_name)).toEqual(["canvas_generate"]);
        await axios.get("https://backend.genra.ai/openai/v1/videos/task-1", { adapter: reply(200, { id: "task-1", status: "in_progress" }) });
        await axios.get("https://backend.genra.ai/openai/v1/videos/task-1", { adapter: reply(200, { id: "task-1", status: "completed", genra: { credits_cost: 6 } }) });
        await axios.get("https://backend.genra.ai/openai/v1/videos/task-1", { adapter: reply(200, { id: "task-1", status: "completed", genra: { credits_cost: 6 } }) });
        expect(sent.map((item) => item.body.event_name)).toEqual(["canvas_generate", "canvas_generate_done"]);
        expect(sent[1].body.event_data).toMatchObject({ capability: "video", seconds: 6, resolution: "480p", success: true, credits_cost: 6 });
    });

    test("requests to other hosts and non-generation calls send nothing", async () => {
        await axios.post("https://elsewhere.test/v1/images/generations", { model: "x" }, { adapter: reply(200, {}) });
        await axios.get("https://backend.genra.ai/openai/v1/models", { adapter: reply(200, { data: [] }) });
        expect(sent).toEqual([]);
    });

    test("nothing is sent outside genra.ai", () => {
        (globalThis.window as { location: { hostname: string } }).location.hostname = "localhost";
        tracker.track("canvas_open", {});
        (globalThis.window as { location: { hostname: string } }).location.hostname = "canvas.genra.ai";
        expect(sent).toEqual([]);
    });
});
