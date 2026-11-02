// Credit prices shown next to models, and estimates for the generate buttons.
// Mirrors the backend's calculate_credits_cost (video_mvp backend/shared/supabase/usage_reporter.py), so an estimate
// matches the charge. Prices arrive with GET /openai/v1/models and persist on the channel models in config.
import i18n from "@/i18n";

export type CreditsPricing = {
    base?: number;
    per_unit?: number;
    per_second?: number;
    per_char?: number;
    resolution_multiplier?: Record<string, number>;
};

export type CostEstimateInput = { count?: number; seconds?: number; resolution?: string };

const NUMERIC_FIELDS = ["base", "per_unit", "per_second", "per_char"] as const;
/** At or below this `speed_score` a model counts as slow; generation usually takes minutes. */
export const SLOW_SPEED_SCORE = 0.3;

const byAlias = new Map<string, CreditsPricing>();
const slowAliases = new Set<string>();

/** Keeps the fields we understand. An unpriced model (`{}` or all zeros) has no pricing, so it shows no label. */
export function normalizePricing(value: unknown): CreditsPricing | undefined {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    const pricing: CreditsPricing = {};
    for (const field of NUMERIC_FIELDS) {
        const amount = source[field];
        if (typeof amount === "number" && amount > 0) pricing[field] = amount;
    }
    if (!pricing.per_unit && !pricing.per_second && !pricing.per_char) return undefined;
    const multiplier = source.resolution_multiplier;
    if (multiplier && typeof multiplier === "object" && Object.keys(multiplier).length) pricing.resolution_multiplier = multiplier as Record<string, number>;
    return pricing;
}

export function setModelCatalog(models: { name: string; pricing?: CreditsPricing; speedScore?: number }[]) {
    byAlias.clear();
    slowAliases.clear();
    for (const model of models) {
        if (model.pricing) byAlias.set(model.name, model.pricing);
        if (model.speedScore !== undefined && model.speedScore <= SLOW_SPEED_SCORE) slowAliases.add(model.name);
    }
}

export function isSlowModel(alias: string | undefined) {
    return alias !== undefined && slowAliases.has(alias);
}

export function getModelPricing(alias: string | undefined) {
    return alias ? byAlias.get(alias) : undefined;
}

/**
 * Billing tier for a pixel size ("1280x720", "477*848") or a tier name ("720p", "720"). Pixel sizes go by short edge using the
 * backend's bands (≤540, ≤900), which leave room for sizes like 477x848. Ratios and "auto" say nothing about pixels: undefined.
 */
export function resolutionTier(resolution: string | undefined) {
    const value = String(resolution ?? "")
        .trim()
        .toLowerCase();
    const pixels = value.match(/^(\d+)\s*[x*]\s*(\d+)$/);
    const named = value.match(/^(\d+)p?$/);
    const shortEdge = pixels ? Math.min(Number(pixels[1]), Number(pixels[2])) : named ? Number(named[1]) : 0;
    if (!shortEdge) return undefined;
    return shortEdge <= 540 ? "480p" : shortEdge <= 900 ? "720p" : "1080p";
}

function resolutionMultiplier(pricing: CreditsPricing, resolution: string | undefined) {
    const multipliers = pricing.resolution_multiplier;
    const tier = resolutionTier(resolution);
    if (!multipliers || !tier) return 1;
    return multipliers[tier] ?? 1;
}

function ceilToCents(value: number) {
    // The epsilon absorbs float noise, so 12.000000000000002 stays 12 and doesn't round up to 12.01.
    return Math.ceil((value - 1e-9) * 100) / 100;
}

export function estimateFromPricing(pricing: CreditsPricing, { count = 1, seconds = 0, resolution }: CostEstimateInput) {
    const base = pricing.base ?? 0;
    if (pricing.per_second) return ceilToCents((base + pricing.per_second * seconds) * resolutionMultiplier(pricing, resolution));
    if (pricing.per_unit) return ceilToCents(base + pricing.per_unit * Math.max(1, count));
    return undefined;
}

export function estimateCost(alias: string | undefined, input: CostEstimateInput) {
    const pricing = getModelPricing(alias);
    return pricing ? estimateFromPricing(pricing, input) : undefined;
}

export function formatCredits(value: number) {
    return String(Math.round(value * 100) / 100);
}

export function pricingLabel(pricing: CreditsPricing) {
    const [key, amount] = pricing.per_second ? ["genra.pricing.perSecond", pricing.per_second] : pricing.per_unit ? ["genra.pricing.perImage", pricing.per_unit] : ["genra.pricing.perChar", pricing.per_char ?? 0];
    return i18n.t(key, { count: amount, price: formatCredits(amount) });
}

export function unitPriceLabel(alias: string | undefined) {
    const pricing = getModelPricing(alias);
    return pricing ? pricingLabel(pricing) : "";
}

export type CreditsCharge = { cost: number; balance?: number; id?: string };

/** `genra.credits_cost` on an image response or a finished video. Video submits carry only `credits_estimate`, which is not a charge. */
export function readCreditsCharge(body: unknown): CreditsCharge | null {
    if (!body || typeof body !== "object") return null;
    const { genra, id } = body as { genra?: { credits_cost?: unknown; credits_balance?: unknown }; id?: unknown };
    if (typeof genra?.credits_cost !== "number" || genra.credits_cost <= 0) return null;
    return { cost: genra.credits_cost, ...(typeof genra.credits_balance === "number" ? { balance: genra.credits_balance } : {}), ...(typeof id === "string" ? { id } : {}) };
}
