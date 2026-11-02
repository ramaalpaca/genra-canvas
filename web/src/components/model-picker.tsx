import { useEffect, useId, useMemo, useState } from "react";
import { Cpu, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "antd";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { promptUpgrade } from "@/services/genra/credits-events";
import { isModelLocked } from "@/services/genra/free-tier";
import { isSlowModel, unitPriceLabel } from "@/services/genra/pricing";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    /** For triggers too narrow to fit both the name and the price. The option list still shows prices. */
    hideTriggerPrice?: boolean;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig, hideTriggerPrice = false }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    // A priced model is always a Genra one, so the channel suffix only costs width next to the price.
    const triggerLabel = !current ? pickerPlaceholder : unitPriceLabel(modelOptionName(current)) ? modelOptionName(current) : modelOptionLabel(config, current);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={(model) => {
                // Locked models stay in the list, so choosing one explains the plan instead of switching to it.
                if (isModelLocked(modelOptionName(model))) promptUpgrade();
                else onChange(model);
            }}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
                <SlowModelTag model={current} className="canvas-model-picker-text" />
                {hideTriggerPrice ? null : <ModelPrice model={current} className="canvas-model-picker-text" />}
                {isModelLocked(modelOptionName(current)) ? <Lock className="size-3 shrink-0 opacity-60" /> : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-[max(20rem,var(--radix-select-trigger-width))] max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} className="[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1" value={model} textValue={modelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const { t } = useTranslation();
    const locked = isModelLocked(modelOptionName(model));
    return (
        <span className={cn("flex w-full min-w-0 items-center gap-2", locked && "opacity-50")}>
            <ModelIcon model={model} />
            <span className="min-w-0 flex-1 truncate">{modelOptionLabel(config, model)}</span>
            <SlowModelTag model={model} />
            {locked ? (
                <span className="flex shrink-0 items-center gap-1 text-xs">
                    <Lock className="size-3" />
                    {t("genra.pricing.paidUnlock")}
                </span>
            ) : (
                <ModelPrice model={model} />
            )}
        </span>
    );
}

function ModelPrice({ model, className }: { model: string; className?: string }) {
    const label = unitPriceLabel(modelOptionName(model));
    return label ? <span className={cn("shrink-0 text-xs opacity-60", className)}>{label}</span> : null;
}

function SlowModelTag({ model, className }: { model: string; className?: string }) {
    const { t } = useTranslation();
    if (!isSlowModel(modelOptionName(model))) return null;
    return (
        // Above the option list (z-[1200]), which would otherwise cover the tooltip.
        <Tooltip title={t("genra.pricing.slowTooltip")} zIndex={1300}>
            <span className={cn("shrink-0 rounded bg-stone-500/15 px-1 text-[10px] leading-4 text-stone-500 dark:text-stone-400", className)}>{t("genra.pricing.slowTag")}</span>
        </Tooltip>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
