// "≈ N credits" beside a generate button, with an orange hint when the balance looks short and a note for slow models.
// The hint never blocks: the balance here can be up to 30 seconds old, and the backend answers 402 if it really is short.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { parsePixelSize, clampVideoSeconds, parseVideoResolution } from "@/lib/media-size";
import { cn } from "@/lib/utils";
import { useCreditsBalance } from "@/services/genra/credits";
import { isFreeUser } from "@/services/genra/free-tier";
import { estimateCost, formatCredits, isSlowModel } from "@/services/genra/pricing";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

type GenraCostEstimateProps = {
    config: AiConfig;
    /** Selected model. The workbenches keep it in `imageModel` / `videoModel` rather than `config.model`. */
    model?: string;
    mode: string;
    /** Overrides `config.count` where the screen clamps it itself. */
    count?: number;
    /** One line instead of two, for the fixed-height config node, where more lines push the button out. Drops the free plan note. */
    inline?: boolean;
    className?: string;
    style?: CSSProperties;
};

function estimateForConfig(config: AiConfig, model: string, mode: string, count: number | undefined) {
    const alias = modelOptionName(model);
    if (mode === "image") return estimateCost(alias, { count: count ?? Math.max(1, Math.floor(Number(config.count) || 1)) });
    if (mode !== "video") return undefined;
    // In ratio mode `size` is "16:9" or "auto", so the tier comes from the resolution setting.
    const resolution = parsePixelSize(config.size) ? config.size : parseVideoResolution(config.vquality);
    return estimateCost(alias, { seconds: Number(clampVideoSeconds(config.videoSeconds)), resolution });
}

export function GenraCostEstimate({ config, model = config.model, mode, count, inline = false, className, style }: GenraCostEstimateProps) {
    const { t } = useTranslation();
    const { data } = useCreditsBalance();
    const estimate = estimateForConfig(config, model, mode, count);
    const generates = mode === "image" || mode === "video";
    const slow = generates && isSlowModel(modelOptionName(model));
    const freeHint = generates && !inline && isFreeUser();
    if (estimate === undefined && !slow && !freeHint) return null;
    const low = estimate !== undefined && data !== undefined && data.total_credits < estimate;
    return (
        <div className={cn("flex text-xs", inline ? "flex-row-reverse items-center gap-2" : "flex-col items-end", className)} style={style}>
            {estimate === undefined ? null : (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {low ? <span className="font-medium text-primary">{t("genra.pricing.lowBalance")}</span> : null}
                    <span>{t("genra.pricing.estimate", { amount: formatCredits(estimate) })}</span>
                </span>
            )}
            {slow ? <span className="whitespace-nowrap text-[11px] opacity-80">{t("genra.pricing.slowHint")}</span> : null}
            {freeHint ? <span className="whitespace-nowrap text-[11px] opacity-80">{t("genra.pricing.freeTierHint")}</span> : null}
        </div>
    );
}
