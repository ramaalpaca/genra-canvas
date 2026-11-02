import { beforeEach, describe, expect, test } from "bun:test";

import { hasErrorCode, isCanvasNotEnabledBody } from "../src/services/genra/access-client";
import { PAID_PLAN_REQUIRED, applyFreeTierLimits, imageScaleCap, isFreeUser, isLockedFor, isModelLocked, normalizeFreeTier, normalizeUserTier, setFreeTierCatalog, videoResolutionCap } from "../src/services/genra/free-tier";

const models = [
    { name: "nano-banana-2", freeTier: { allowed: true, imageSize: "1K" } },
    { name: "nano-banana-pro", freeTier: { allowed: false } },
    { name: "seedance-v2-mini", freeTier: { allowed: true, maxResolution: "480p" } },
    { name: "veo", freeTier: { allowed: false } },
    { name: "no-rule" },
];

describe("normalizing backend fields", () => {
    test("reads a full rule", () => {
        expect(normalizeFreeTier({ allowed: true, max_resolution: "480p", image_size: "1K" })).toEqual({ allowed: true, maxResolution: "480p", imageSize: "1K" });
    });

    test("nulls in the rule are dropped", () => {
        expect(normalizeFreeTier({ allowed: true, max_resolution: null, image_size: "1K" })).toEqual({ allowed: true, imageSize: "1K" });
    });

    test("a missing or malformed rule is no rule", () => {
        expect(normalizeFreeTier(undefined)).toBeUndefined();
        expect(normalizeFreeTier(null)).toBeUndefined();
        expect(normalizeFreeTier({ max_resolution: "480p" })).toBeUndefined();
    });

    test("only an explicit free counts as free", () => {
        expect(normalizeUserTier("free")).toBe("free");
        expect(normalizeUserTier("paid")).toBe("paid");
        expect(normalizeUserTier(undefined)).toBe("paid");
        expect(normalizeUserTier("trial")).toBe("paid");
    });
});

describe("free user", () => {
    beforeEach(() => setFreeTierCatalog("free", models));

    test("is recognised", () => {
        expect(isFreeUser()).toBe(true);
    });

    test("models marked not allowed are locked", () => {
        expect(isModelLocked("nano-banana-pro")).toBe(true);
        expect(isModelLocked("veo")).toBe(true);
    });

    test("allowed models and models with no rule are open", () => {
        expect(isModelLocked("nano-banana-2")).toBe(false);
        expect(isModelLocked("no-rule")).toBe(false);
        expect(isModelLocked(undefined)).toBe(false);
    });

    test("allowed models carry their caps", () => {
        expect(videoResolutionCap("seedance-v2-mini")).toBe(480);
        expect(imageScaleCap("nano-banana-2")).toBe("1k");
    });

    test("a model with no rule has no cap", () => {
        expect(videoResolutionCap("no-rule")).toBeUndefined();
        expect(imageScaleCap("no-rule")).toBeUndefined();
    });

    test("video settings fall to the allowed tier and keep the ratio", () => {
        expect(applyFreeTierLimits({ size: "1920x1080", vquality: "1080" }, "video", "seedance-v2-mini")).toEqual({ size: "854x480", vquality: "480" });
        expect(applyFreeTierLimits({ size: "720x1280", vquality: "720" }, "video", "seedance-v2-mini")).toEqual({ size: "480x854", vquality: "480" });
    });

    test("a ratio-only video size is left for the tier to size", () => {
        expect(applyFreeTierLimits({ size: "16:9", vquality: "720" }, "video", "seedance-v2-mini")).toEqual({ size: "16:9", vquality: "480" });
    });

    test("video settings already within the cap are returned as they are", () => {
        const config = { size: "854x480", vquality: "480" };
        expect(applyFreeTierLimits(config, "video", "seedance-v2-mini")).toEqual(config);
    });

    test("image size falls to 1K and keeps the ratio", () => {
        expect(applyFreeTierLimits({ size: "2048x1152", vquality: "720" }, "image", "nano-banana-2").size).toBe("1536x864");
        expect(applyFreeTierLimits({ size: "2880x2880", vquality: "720" }, "image", "nano-banana-2").size).toBe("1024x1024");
    });

    test("auto and ratio-only image sizes become a concrete 1K size", () => {
        expect(applyFreeTierLimits({ size: "auto", vquality: "720" }, "image", "nano-banana-2").size).toBe("1024x1024");
        expect(applyFreeTierLimits({ size: "16:9", vquality: "720" }, "image", "nano-banana-2").size).toBe("1536x864");
    });

    test("a 1K image size is returned unchanged", () => {
        const config = { size: "1536x864", vquality: "720" };
        expect(applyFreeTierLimits(config, "image", "nano-banana-2")).toBe(config);
    });

    test("text generation is untouched", () => {
        const config = { size: "2048x1152", vquality: "1080" };
        expect(applyFreeTierLimits(config, "text", "nano-banana-2")).toBe(config);
    });

    test("a locked model gets no cap, since it can't run at any tier", () => {
        const config = { size: "1920x1080", vquality: "1080" };
        expect(applyFreeTierLimits(config, "video", "veo")).toBe(config);
    });
});

describe("paid user", () => {
    beforeEach(() => setFreeTierCatalog("paid", models));

    test("nothing is locked or capped", () => {
        expect(isFreeUser()).toBe(false);
        expect(isModelLocked("veo")).toBe(false);
        expect(videoResolutionCap("seedance-v2-mini")).toBeUndefined();
        expect(imageScaleCap("nano-banana-2")).toBeUndefined();
    });

    test("settings pass through", () => {
        const config = { size: "1920x1080", vquality: "1080" };
        expect(applyFreeTierLimits(config, "video", "seedance-v2-mini")).toBe(config);
    });
});

describe("missing backend fields lock nothing", () => {
    test("no user tier", () => {
        setFreeTierCatalog(undefined, models);
        expect(isFreeUser()).toBe(false);
        expect(isModelLocked("veo")).toBe(false);
        expect(videoResolutionCap("seedance-v2-mini")).toBeUndefined();
    });

    test("free user but no rules at all", () => {
        setFreeTierCatalog("free", [{ name: "veo" }, { name: "nano-banana-pro" }]);
        expect(isModelLocked("veo")).toBe(false);
        expect(imageScaleCap("nano-banana-pro")).toBeUndefined();
    });

    test("isLockedFor needs both an explicit free tier and an explicit refusal", () => {
        expect(isLockedFor("free", { allowed: false })).toBe(true);
        expect(isLockedFor(undefined, { allowed: false })).toBe(false);
        expect(isLockedFor("paid", { allowed: false })).toBe(false);
        expect(isLockedFor("free", undefined)).toBe(false);
    });
});

describe("paid_plan_required error", () => {
    test("is recognised in the facade's error shape", () => {
        expect(hasErrorCode({ error: { message: "no", type: "forbidden", code: PAID_PLAN_REQUIRED, param: null } }, PAID_PLAN_REQUIRED)).toBe(true);
        expect(hasErrorCode(JSON.stringify({ error: { code: PAID_PLAN_REQUIRED } }), PAID_PLAN_REQUIRED)).toBe(true);
    });

    test("is not confused with canvas access being refused", () => {
        const body = { error: { code: PAID_PLAN_REQUIRED } };
        expect(isCanvasNotEnabledBody(body)).toBe(false);
        expect(hasErrorCode({ error: "canvas_not_enabled" }, PAID_PLAN_REQUIRED)).toBe(false);
    });
});

test("a slow model the free plan can't use is both locked and slow", async () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    const { isSlowModel, setModelCatalog } = await import("../src/services/genra/pricing");
    const models = [{ name: "minimax-h3", speedScore: 0.2, freeTier: { allowed: false } }];
    setModelCatalog(models);
    setFreeTierCatalog("free", models);
    expect(isSlowModel("minimax-h3")).toBe(true);
    expect(isModelLocked("minimax-h3")).toBe(true);
});
