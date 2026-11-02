// Auto-injected, locked "Genra" provider channel: baseUrl = Genra OpenAI-compatible facade, apiKey = the user's Supabase JWT.
// Model ids from /v1/models are aliases (nano-banana-2.1, seedance-v2-mini, genra-text…) merged by the facade; `genra.capability` groups them.
import axios from "axios";

import { encodeChannelModel, modelOptionName, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

import { getGenraAccessToken, watchGenraSession } from "./auth";
import { GENRA_CHANNEL_ID, GENRA_CHANNEL_LOCKED, GENRA_CHANNEL_NAME, GENRA_OPENAI_BASE_URL } from "./env";
import { isLockedFor, normalizeFreeTier, normalizeUserTier, setFreeTierCatalog, type UserTier } from "./free-tier";
import { normalizePricing, setModelCatalog } from "./pricing";

type GenraModelItem = {
    id?: string;
    genra?: { capability?: string; display_name?: string | null; speed_score?: number | null; model_ids?: string[]; credits_pricing?: Record<string, unknown>; free_tier?: unknown };
};

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];
// First match wins when the user has no valid selection for that capability: a new user, or a saved model the backend dropped.
const PREFERRED_DEFAULTS: Partial<Record<ModelCapability, string[]>> = { image: ["nano-banana-2.1", "nano-banana-pro"], video: ["seedance-v2-mini", "veo"], text: ["genra-text"] };

export function createGenraChannel(apiKey = "", models: ChannelModel[] = [], userTier?: UserTier): ModelChannel {
    return { id: GENRA_CHANNEL_ID, name: GENRA_CHANNEL_NAME, baseUrl: GENRA_OPENAI_BASE_URL, apiKey, apiFormat: "openai", models, ...(userTier ? { userTier } : {}) };
}

/** GET /openai/v1/models → channel models grouped by the facade's `genra.capability`. */
export async function fetchGenraModels(accessToken: string): Promise<{ models: ChannelModel[]; userTier: UserTier }> {
    const response = await axios.get<{ data?: GenraModelItem[]; genra?: { user_tier?: unknown } }>(`${GENRA_OPENAI_BASE_URL}/v1/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const models = (response.data.data || []).flatMap((item) => {
        const capability = item.genra?.capability as ModelCapability | undefined;
        const pricing = normalizePricing(item.genra?.credits_pricing);
        const speedScore = item.genra?.speed_score;
        const displayName = item.genra?.display_name;
        const freeTier = normalizeFreeTier(item.genra?.free_tier);
        return item.id && capability && CAPABILITIES.includes(capability) ? [{ name: item.id, capability, ...(pricing ? { pricing } : {}), ...(typeof speedScore === "number" ? { speedScore } : {}), ...(displayName ? { displayName } : {}), ...(freeTier ? { freeTier } : {}) }] : [];
    });
    return { models, userTier: normalizeUserTier(response.data.genra?.user_tier) };
}

/** Put the Genra channel into the config (replacing all others when locked) and make sure every capability has a default model. */
export function applyGenraChannel(config: AiConfig, channel: ModelChannel): AiConfig {
    const channels = GENRA_CHANNEL_LOCKED ? [channel] : [channel, ...config.channels.filter((item) => item.id !== GENRA_CHANNEL_ID)];
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    // Locked models stay listed in the picker, but a free account's default must be one it can actually run.
    const genra = config.channels.find((channel) => channel.id === GENRA_CHANNEL_ID);
    const lockedNames = new Set(genra?.models.filter((model) => isLockedFor(genra.userTier, model.freeTier)).map((model) => model.name));
    const selectable = selectableModelsByCapability(config, capability);
    const usable = selectable.filter((value) => !lockedNames.has(modelOptionName(value)));
    const options = usable.length ? usable : selectable;
    const normalized = normalizeModelOptionValue(current, config.channels);
    if (options.includes(normalized)) return normalized;
    const preferred = (PREFERRED_DEFAULTS[capability] || []).map((name) => encodeChannelModel(GENRA_CHANNEL_ID, name)).find((value) => options.includes(value));
    return preferred || options[0] || "";
}

function currentGenraChannel() {
    return useConfigStore.getState().config.channels.find((channel) => channel.id === GENRA_CHANNEL_ID);
}

function writeGenraChannel(channel: ModelChannel) {
    useConfigStore.setState((state) => ({ config: applyGenraChannel(state.config, channel) }));
}

let modelsRequested = false;

/**
 * App bootstrap: resolve the Genra session, inject the channel with the current JWT, load the model list once,
 * and keep the channel's apiKey in sync whenever supabase-js refreshes the token.
 */
export function startGenraSession() {
    const syncCatalog = () => {
        const channel = currentGenraChannel();
        setModelCatalog(channel?.models ?? []);
        setFreeTierCatalog(channel?.userTier, channel?.models ?? []);
    };
    syncCatalog();
    useConfigStore.subscribe(syncCatalog);
    return watchGenraSession((session) => {
        const existing = currentGenraChannel();
        if (existing?.apiKey !== session.access_token) writeGenraChannel(createGenraChannel(session.access_token, existing?.models || [], existing?.userTier));
        if (modelsRequested) return;
        modelsRequested = true;
        fetchGenraModels(session.access_token)
            .then(({ models, userTier }) => writeGenraChannel(createGenraChannel(getGenraAccessToken(), models, userTier)))
            .catch((error) => {
                modelsRequested = false;
                console.warn("[genra] failed to load models", error);
            });
    });
}

/** Re-fetch the model list (e.g. from a settings button). */
export async function refreshGenraModels() {
    const { models, userTier } = await fetchGenraModels(getGenraAccessToken());
    writeGenraChannel(createGenraChannel(getGenraAccessToken(), models, userTier));
    return models;
}
