// Free plan limits: which models and quality tiers an unpaid account can use.
// Everything fails open: a missing `user_tier` or `free_tier` means no lock, so an older backend never shuts anyone out.
// The backend still enforces this with 403 paid_plan_required; these rules only stop people from picking what will be refused.
import { computeMediaSize, computeVideoSize, inferMediaRatio, inferMediaScale, inferVideoRatio, parsePixelSize, parseVideoResolution } from "@/lib/media-size";

export type UserTier = "free" | "paid";
export type FreeTierRule = { allowed: boolean; maxResolution?: string; imageSize?: string };

export const PAID_PLAN_REQUIRED = "paid_plan_required";

let userTier: UserTier = "paid";
const rules = new Map<string, FreeTierRule>();

export function normalizeUserTier(value: unknown): UserTier {
    return value === "free" ? "free" : "paid";
}

export function normalizeFreeTier(value: unknown): FreeTierRule | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { allowed, max_resolution: maxResolution, image_size: imageSize } = value as Record<string, unknown>;
    if (typeof allowed !== "boolean") return undefined;
    return { allowed, ...(typeof maxResolution === "string" && maxResolution ? { maxResolution } : {}), ...(typeof imageSize === "string" && imageSize ? { imageSize } : {}) };
}

export function setFreeTierCatalog(tier: UserTier | undefined, models: { name: string; freeTier?: FreeTierRule }[]) {
    userTier = tier ?? "paid";
    rules.clear();
    for (const model of models) {
        if (model.freeTier) rules.set(model.name, model.freeTier);
    }
}

export function isFreeUser() {
    return userTier === "free";
}

export function isLockedFor(tier: UserTier | undefined, rule: FreeTierRule | undefined) {
    return tier === "free" && rule?.allowed === false;
}

export function isModelLocked(alias: string | undefined) {
    return alias !== undefined && isLockedFor(userTier, rules.get(alias));
}

function allowedRule(alias: string | undefined) {
    const rule = alias === undefined || userTier !== "free" ? undefined : rules.get(alias);
    return rule?.allowed ? rule : undefined;
}

/** Highest video tier as a short edge (480), or undefined when uncapped. */
export function videoResolutionCap(alias: string | undefined) {
    const value = allowedRule(alias)?.maxResolution;
    const cap = value ? Number.parseInt(value, 10) : Number.NaN;
    return cap > 0 ? cap : undefined;
}

/** Only image size allowed, in the app's lowercase form ("1k"), or undefined when uncapped. */
export function imageScaleCap(alias: string | undefined) {
    return allowedRule(alias)?.imageSize?.toLowerCase();
}

/**
 * Settings to display and send under the free plan. Stored settings are left alone on purpose: whatever someone chose
 * comes back by itself once they upgrade, and a single stale node or saved default can't send a refused request.
 */
export function applyFreeTierLimits<T extends { size: string; vquality: string }>(config: T, mode: string, alias: string | undefined): T {
    if (mode === "image") {
        const cap = imageScaleCap(alias);
        if (!cap || inferMediaScale(config.size) === cap) return config;
        const ratio = inferMediaRatio(config.size);
        return { ...config, size: computeMediaSize(cap, ratio === "auto" ? "1:1" : ratio) };
    }
    if (mode !== "video") return config;
    const cap = videoResolutionCap(alias);
    if (!cap) return config;
    const pixels = parsePixelSize(config.size);
    const oversize = pixels && Math.min(pixels.width, pixels.height) > cap;
    return {
        ...config,
        vquality: Number(parseVideoResolution(config.vquality)) > cap ? String(cap) : config.vquality,
        ...(oversize ? { size: computeVideoSize(String(cap), inferVideoRatio(config.size)) } : {}),
    };
}
