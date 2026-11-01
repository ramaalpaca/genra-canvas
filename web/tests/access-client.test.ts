import { describe, expect, test } from "bun:test";

import { checkCanvasAccess, isCanvasNotEnabledBody, withCanvasDenialCheck } from "../src/services/genra/access-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const check = (respond: () => Response | Promise<Response>) => checkCanvasAccess({ url: "https://api.test/api/v1/canvas/access", token: "jwt", fetchImpl: (async () => respond()) as unknown as typeof fetch });

describe("checkCanvasAccess", () => {
    test("sends the bearer token", async () => {
        let headers: Headers | undefined;
        await checkCanvasAccess({
            url: "https://api.test/access",
            token: "jwt",
            fetchImpl: (async (_url: string, init: RequestInit) => {
                headers = new Headers(init.headers);
                return json({ enabled: true, mode: "beta" });
            }) as typeof fetch,
        });
        expect(headers?.get("Authorization")).toBe("Bearer jwt");
    });

    test("enabled", async () => {
        expect(await check(() => json({ enabled: true, mode: "all" }))).toEqual({ status: "enabled", mode: "all" });
    });

    test("disabled", async () => {
        expect(await check(() => json({ enabled: false, mode: "beta" }))).toEqual({ status: "disabled", mode: "beta" });
    });

    test("a 403 canvas_not_enabled from the access endpoint also means disabled", async () => {
        expect((await check(() => json({ error: "canvas_not_enabled", message: "no" }, 403))).status).toBe("disabled");
    });

    test("401 goes to the login flow", async () => {
        expect(await check(() => json({ error: "unauthorized", message: "no" }, 401))).toEqual({ status: "unauthorized" });
    });

    test("404, while the backend is not deployed, is unreachable and not a beta rejection", async () => {
        expect(await check(() => json({ detail: "Not Found" }, 404))).toEqual({ status: "unreachable" });
    });

    test("a network error is unreachable", async () => {
        expect(await check(() => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ status: "unreachable" });
    });

    test("a server error is unreachable", async () => {
        expect(await check(() => json({ error: "internal_error", message: "boom" }, 500))).toEqual({ status: "unreachable" });
    });

    test("an unrelated 403 is unreachable and not a beta rejection", async () => {
        expect(await check(() => json({ error: "forbidden", message: "no" }, 403))).toEqual({ status: "unreachable" });
    });

    test("a success that is not the expected JSON never opens the canvas", async () => {
        expect(await check(() => new Response("<html></html>"))).toEqual({ status: "unreachable" });
        expect(await check(() => json({ mode: "all" }))).toEqual({ status: "unreachable" });
    });

    test("an unknown mode is treated as beta", async () => {
        expect(await check(() => json({ enabled: true, mode: "later" }))).toEqual({ status: "enabled", mode: "beta" });
    });
});

describe("isCanvasNotEnabledBody", () => {
    test.each([
        ["canvas API", { error: "canvas_not_enabled", message: "no" }],
        ["code field", { code: "canvas_not_enabled" }],
        ["OpenAI facade", { error: { message: "no", type: "forbidden", code: "canvas_not_enabled", param: null } }],
        ["FastAPI detail", { detail: { error: "canvas_not_enabled" } }],
        ["FastAPI detail string", { detail: "canvas_not_enabled" }],
        ["serialized text", '{"error":"canvas_not_enabled"}'],
    ])("recognises %s", (_name, body) => {
        expect(isCanvasNotEnabledBody(body)).toBe(true);
    });

    test.each([
        ["other error", { error: "forbidden" }],
        ["message mentioning it", { message: "canvas_not_enabled" }],
        ["empty", null],
        ["html", "<html>403</html>"],
    ])("ignores %s", (_name, body) => {
        expect(isCanvasNotEnabledBody(body)).toBe(false);
    });
});

describe("withCanvasDenialCheck", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    test("reports a 403 canvas_not_enabled and leaves the body readable for the caller", async () => {
        let denied = 0;
        const wrapped = withCanvasDenialCheck((async () => json({ error: "canvas_not_enabled", message: "no" }, 403)) as unknown as typeof fetch, () => (denied += 1));
        const response = await wrapped("https://api.test/openai/v1/images");
        await settle();
        expect(denied).toBe(1);
        expect(await response.json()).toEqual({ error: "canvas_not_enabled", message: "no" });
    });

    test("ignores other 403s and successes", async () => {
        let denied = 0;
        const forbidden = withCanvasDenialCheck((async () => json({ error: "forbidden" }, 403)) as unknown as typeof fetch, () => (denied += 1));
        const ok = withCanvasDenialCheck((async () => json({ error: "canvas_not_enabled" })) as unknown as typeof fetch, () => (denied += 1));
        await forbidden("https://api.test/a");
        await ok("https://api.test/b");
        await settle();
        expect(denied).toBe(0);
    });

    test("passes network errors through", async () => {
        const wrapped = withCanvasDenialCheck((async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch, () => undefined);
        await expect(wrapped("https://api.test/a")).rejects.toThrow("Failed to fetch");
    });
});
