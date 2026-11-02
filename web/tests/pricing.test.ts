import { beforeAll, describe, expect, test } from "bun:test";

// pricing.ts imports i18n, which reads browser storage during module initialization.
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
const { default: i18n } = await import("../src/i18n");
const { estimateCost, estimateFromPricing, formatCredits, getModelPricing, normalizePricing, pricingLabel, readCreditsCharge, resolutionTier, setModelPricing, unitPriceLabel } = await import("../src/services/genra/pricing");

const video = { per_second: 8, resolution_multiplier: { "480p": 0.25, "720p": 0.5, "1080p": 0.5 } };

beforeAll(() => {
    setModelPricing([{ name: "nano-banana-pro", pricing: { per_unit: 1 } }, { name: "veo", pricing: video }, { name: "genra-text" }]);
});

describe("normalizePricing", () => {
    test("keeps image and video prices", () => {
        expect(normalizePricing({ per_unit: 1, resolution_multiplier: {} })).toEqual({ per_unit: 1 });
        expect(normalizePricing(video)).toEqual(video);
    });

    test("an unpriced model has no pricing", () => {
        expect(normalizePricing({})).toBeUndefined();
        expect(normalizePricing({ per_unit: 0 })).toBeUndefined();
        expect(normalizePricing(null)).toBeUndefined();
        expect(normalizePricing({ per_unit: "1" })).toBeUndefined();
    });

    test("ignores the fields the backend is adding", () => {
        expect(normalizePricing({ per_unit: 2, credits_pricing_source: "model", credits_event_type: "image_generation" })).toEqual({ per_unit: 2 });
    });
});

describe("resolutionTier", () => {
    test.each([
        ["480p", "480p"],
        ["720", "720p"],
        ["1080p", "1080p"],
        ["1280x720", "720p"],
        ["720x1280", "720p"],
        ["1920*1080", "1080p"],
        ["848x480", "480p"],
        ["477x848", "480p"],
        ["1024x576", "720p"],
        ["2160p", "1080p"],
    ])("%s is %s", (value, tier) => {
        expect(resolutionTier(value)).toBe(tier);
    });

    test.each(["16:9", "auto", "", undefined])("%s has no tier", (value) => {
        expect(resolutionTier(value)).toBeUndefined();
    });
});

describe("estimateCost", () => {
    test("image is price times count", () => {
        expect(estimateCost("nano-banana-pro", { count: 3 })).toBe(3);
    });

    test("video is price times seconds times the tier multiplier", () => {
        expect(estimateCost("veo", { seconds: 6, resolution: "720" })).toBe(24);
        expect(estimateCost("veo", { seconds: 6, resolution: "1280x720" })).toBe(24);
        expect(estimateCost("veo", { seconds: 6, resolution: "480p" })).toBe(12);
    });

    test("a tier with no multiplier, or no tier at all, counts as 1", () => {
        expect(estimateFromPricing({ per_second: 8, resolution_multiplier: { "480p": 0.25 } }, { seconds: 5, resolution: "1080p" })).toBe(40);
        expect(estimateCost("veo", { seconds: 5, resolution: "16:9" })).toBe(40);
        expect(estimateFromPricing({ per_second: 8 }, { seconds: 5, resolution: "480p" })).toBe(40);
    });

    test("includes base and rounds up to two decimals like the backend", () => {
        expect(estimateFromPricing({ base: 1, per_second: 2 }, { seconds: 3 })).toBe(7);
        expect(estimateFromPricing({ per_second: 0.333 }, { seconds: 1 })).toBe(0.34);
    });

    test("float noise does not round up", () => {
        expect(estimateFromPricing({ per_second: 0.1 }, { seconds: 3 })).toBe(0.3);
    });

    test("an unknown or unpriced model has no estimate", () => {
        expect(estimateCost("genra-text", {})).toBeUndefined();
        expect(estimateCost("missing", { count: 1 })).toBeUndefined();
        expect(estimateCost(undefined, { count: 1 })).toBeUndefined();
    });

    test("a model priced by character has no count-based estimate", () => {
        expect(estimateFromPricing({ per_char: 0.01 }, { count: 2 })).toBeUndefined();
    });
});

describe("labels", () => {
    test("Chinese", async () => {
        await i18n.changeLanguage("zh-CN");
        expect(unitPriceLabel("nano-banana-pro")).toBe("1 credits / 张");
        expect(unitPriceLabel("veo")).toBe("8 credits / 秒");
    });

    test("English handles the singular", async () => {
        await i18n.changeLanguage("en-US");
        expect(unitPriceLabel("nano-banana-pro")).toBe("1 credit / image");
        expect(unitPriceLabel("veo")).toBe("8 credits / sec");
        expect(pricingLabel({ per_char: 0.01 })).toBe("0.01 credits / char");
    });

    test("an unpriced model has no label", () => {
        expect(unitPriceLabel("genra-text")).toBe("");
        expect(getModelPricing("genra-text")).toBeUndefined();
    });

    test("trims trailing zeros", () => {
        expect(formatCredits(3)).toBe("3");
        expect(formatCredits(1.5)).toBe("1.5");
        expect(formatCredits(0.3000000001)).toBe("0.3");
    });
});

describe("readCreditsCharge", () => {
    test("reads the cost and balance", () => {
        expect(readCreditsCharge({ data: [], genra: { credits_cost: 3, credits_balance: 1573 } })).toEqual({ cost: 3, balance: 1573 });
    });

    test("works without a balance and keeps a video id", () => {
        expect(readCreditsCharge({ id: "task", genra: { credits_cost: 24 } })).toEqual({ cost: 24, id: "task" });
    });

    test("a video submit's estimate is not a charge", () => {
        expect(readCreditsCharge({ id: "task", status: "queued", genra: { credits_estimate: 24 } })).toBeNull();
    });

    test("ignores free responses and other bodies", () => {
        expect(readCreditsCharge({ genra: { credits_cost: 0 } })).toBeNull();
        expect(readCreditsCharge({ data: [] })).toBeNull();
        expect(readCreditsCharge(null)).toBeNull();
        expect(readCreditsCharge("text")).toBeNull();
    });
});
