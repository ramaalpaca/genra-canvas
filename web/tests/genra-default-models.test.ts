import { describe, expect, test } from "bun:test";

import type { AiConfig, ChannelModel } from "../src/stores/use-config-store";

// channel.ts creates the Supabase client and reads browser storage during module initialization.
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "test";
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });

const { applyGenraChannel, createGenraChannel } = await import("../src/services/genra/channel");
const { createModelChannel, defaultConfig, modelMatchesCapability, normalizeChannelModels } = await import("../src/stores/use-config-store");

const image = (name: string): ChannelModel => ({ name, capability: "image" });
const video = (name: string): ChannelModel => ({ name, capability: "video" });
const lineup = [...["nano-banana-2.1", "nano-banana-2", "nano-banana-2-lite", "nano-banana-pro", "gpt-image-2.5", "grok-image"].map(image), ...["seedance-v2-mini", "grok-video"].map(video)];
const apply = (models: ChannelModel[], saved: Partial<AiConfig> = {}) => applyGenraChannel({ ...defaultConfig, ...saved }, createGenraChannel("jwt", models));

describe("Genra default models", () => {
    test("a new user gets the preferred defaults", () => {
        const config = apply(lineup);
        expect(config.imageModel).toBe("genra::nano-banana-2.1");
        expect(config.videoModel).toBe("genra::seedance-v2-mini");
    });

    test("a saved model that left the list falls back to the new default", () => {
        const config = apply(lineup, { imageModel: "genra::gpt-image-2", videoModel: "genra::veo" });
        expect(config.imageModel).toBe("genra::nano-banana-2.1");
        expect(config.videoModel).toBe("genra::seedance-v2-mini");
    });

    test("a saved value without a channel prefix falls back too", () => {
        expect(apply(lineup, { videoModel: "veo" }).videoModel).toBe("genra::seedance-v2-mini");
    });

    test("a saved model still on the list is kept", () => {
        const config = apply(lineup, { imageModel: "genra::nano-banana-pro", videoModel: "genra::grok-video" });
        expect(config.imageModel).toBe("genra::nano-banana-pro");
        expect(config.videoModel).toBe("genra::grok-video");
    });

    test("the second preference is used when the first is missing", () => {
        const config = apply([image("nano-banana-pro"), image("grok-image"), video("veo"), video("grok-video")]);
        expect(config.imageModel).toBe("genra::nano-banana-pro");
        expect(config.videoModel).toBe("genra::veo");
    });

    test("with no preferred model, the first of the capability is used", () => {
        expect(apply([image("grok-image"), video("grok-video")]).imageModel).toBe("genra::grok-image");
    });

    test("a workbench record's removed model does not count as selectable", () => {
        const config = apply(lineup);
        expect(modelMatchesCapability(config, "genra::veo", "video")).toBe(false);
        expect(modelMatchesCapability(config, "veo", "video")).toBe(false);
        expect(modelMatchesCapability(config, "genra::seedance-v2-mini", "video")).toBe(true);
    });
});

test("speed score and display name survive config normalization, including a score of 0", () => {
    const [model] = normalizeChannelModels([{ name: "minimax-h3", capability: "video", speedScore: 0, displayName: "MiniMax H3" }]);
    expect(model).toMatchObject({ speedScore: 0, displayName: "MiniMax H3" });
    expect(normalizeChannelModels([{ name: "veo", capability: "video" }])[0]).not.toHaveProperty("speedScore");
});

describe("free plan defaults", () => {
    const open = (model: ChannelModel): ChannelModel => ({ ...model, freeTier: { allowed: true } });
    const locked = (model: ChannelModel): ChannelModel => ({ ...model, freeTier: { allowed: false } });
    const models = [locked(image("nano-banana-2.1")), locked(image("nano-banana-pro")), open(image("nano-banana-2")), locked(video("veo")), open(video("seedance-v2-mini")), open(video("grok-video"))];
    const applyAs = (userTier: "free" | "paid" | undefined, saved: Partial<AiConfig> = {}) => applyGenraChannel({ ...defaultConfig, ...saved }, createGenraChannel("jwt", models, userTier));

    test("a new free user defaults to an allowed model", () => {
        expect(applyAs("free").imageModel).toBe("genra::nano-banana-2");
        expect(applyAs("free").videoModel).toBe("genra::seedance-v2-mini");
    });

    test("a saved locked model falls back for a free user", () => {
        expect(applyAs("free", { imageModel: "genra::nano-banana-pro" }).imageModel).toBe("genra::nano-banana-2");
    });

    test("a saved allowed model is kept", () => {
        expect(applyAs("free", { videoModel: "genra::grok-video" }).videoModel).toBe("genra::grok-video");
    });

    test("a paid user keeps a model the free plan can't use", () => {
        expect(applyAs("paid").imageModel).toBe("genra::nano-banana-2.1");
        expect(applyAs("paid", { imageModel: "genra::nano-banana-pro" }).imageModel).toBe("genra::nano-banana-pro");
    });

    test("no user tier behaves like paid", () => {
        expect(applyAs(undefined, { imageModel: "genra::nano-banana-pro" }).imageModel).toBe("genra::nano-banana-pro");
    });

    test("if every model is locked the default still resolves, leaving the picker to explain", () => {
        const config = applyGenraChannel(defaultConfig, createGenraChannel("jwt", [locked(video("veo"))], "free"));
        expect(config.videoModel).toBe("genra::veo");
    });

    test("user tier and free tier rules survive saving and restoring", () => {
        const [model] = normalizeChannelModels([{ name: "veo", capability: "video", freeTier: { allowed: false } }]);
        expect(model.freeTier).toEqual({ allowed: false });
        expect(createModelChannel({ id: "genra", userTier: "free" }).userTier).toBe("free");
    });
});
