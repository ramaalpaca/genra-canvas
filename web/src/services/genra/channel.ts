// Auto-injected, locked "Genra" provider channel: baseUrl = Genra OpenAI-compatible facade, apiKey = the user's Supabase JWT.
// Model ids from /v1/models are aliases (nano-banana-pro, veo, genra-text…) merged by the facade; `genra.capability` groups them.
import axios from "axios";

import { encodeChannelModel, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

import { getGenraAccessToken, watchGenraSession } from "./auth";
import { GENRA_CHANNEL_ID, GENRA_CHANNEL_LOCKED, GENRA_CHANNEL_NAME, GENRA_OPENAI_BASE_URL } from "./env";

type GenraModelItem = {
    id?: string;
    genra?: { capability?: string; display_name?: string | null; model_ids?: string[]; credits_pricing?: Record<string, unknown> };
};

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];
// First match wins when the user has no valid selection for that capability yet.
const PREFERRED_DEFAULTS: Partial<Record<ModelCapability, string[]>> = { image: ["nano-banana-pro"], video: ["veo"], text: ["genra-text"] };

export function createGenraChannel(apiKey = "", models: ChannelModel[] = []): ModelChannel {
    return { id: GENRA_CHANNEL_ID, name: GENRA_CHANNEL_NAME, baseUrl: GENRA_OPENAI_BASE_URL, apiKey, apiFormat: "openai", models };
}

/** GET /openai/v1/models → channel models grouped by the facade's `genra.capability`. */
export async function fetchGenraModels(accessToken: string): Promise<ChannelModel[]> {
    const response = await axios.get<{ data?: GenraModelItem[] }>(`${GENRA_OPENAI_BASE_URL}/v1/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return (response.data.data || []).flatMap((item) => {
        const capability = item.genra?.capability as ModelCapability | undefined;
        return item.id && capability && CAPABILITIES.includes(capability) ? [{ name: item.id, capability }] : [];
    });
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
    const options = selectableModelsByCapability(config, capability);
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
    return watchGenraSession((session) => {
        const existing = currentGenraChannel();
        if (existing?.apiKey !== session.access_token) writeGenraChannel(createGenraChannel(session.access_token, existing?.models || []));
        if (modelsRequested) return;
        modelsRequested = true;
        fetchGenraModels(session.access_token)
            .then((models) => writeGenraChannel(createGenraChannel(getGenraAccessToken(), models)))
            .catch((error) => {
                modelsRequested = false;
                console.warn("[genra] failed to load models", error);
            });
    });
}

/** Re-fetch the model list (e.g. from a settings button). */
export async function refreshGenraModels() {
    const models = await fetchGenraModels(getGenraAccessToken());
    writeGenraChannel(createGenraChannel(getGenraAccessToken(), models));
    return models;
}
