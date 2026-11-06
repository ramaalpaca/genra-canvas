// Genra account UI shared by the app header, the canvas page top bar and the mobile drawer:
// credits badge + account actions (settings / about / open Genra / sign out) + the about dialog.
import type { ReactNode } from "react";
import { Coins, ExternalLink, Info, LogOut, Settings2 } from "lucide-react";
import { Dropdown, Modal, Tooltip } from "antd";
import { Trans, useTranslation } from "react-i18next";
import { create } from "zustand";

import { GenraBetaBadge } from "@/components/layout/genra-beta-badge";
import { APP_VERSION } from "@/constant/env";
import { signOutGenra, useGenraAuth } from "@/services/genra/auth";
import { GENRA_FRONTEND_URL, GENRA_PRODUCTION_UI, UPSTREAM_AUTHOR, UPSTREAM_REPO_URL } from "@/services/genra/env";
import { GENRA_PRICING_URL, useCreditsBalance } from "@/services/genra/credits";
import { useConfigStore } from "@/stores/use-config-store";

const useGenraAboutStore = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

function useCreditsLabel() {
    const { t } = useTranslation();
    const { data, isPending, isError } = useCreditsBalance();
    return isError ? t("genra.creditsUnavailable") : isPending ? t("genra.creditsLoading") : t("genra.credits", { count: Math.floor(data?.total_credits ?? 0) });
}

type GenraAccountAction = { key: string; icon: ReactNode; label: string; onClick: () => void };

/** Same actions in the account dropdown and the mobile drawer. Grouped: app actions, then sign out. */
function useGenraAccountActions(iconClassName: string): GenraAccountAction[][] {
    const { t } = useTranslation();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const setAboutOpen = useGenraAboutStore((state) => state.setOpen);
    return [
        [
            { key: "config", icon: <Settings2 className={iconClassName} />, label: t("navigation.config"), onClick: () => openConfigDialog(false) },
            ...(GENRA_PRODUCTION_UI ? [{ key: "about", icon: <Info className={iconClassName} />, label: t("genra.about"), onClick: () => setAboutOpen(true) }] : []),
            { key: "genra", icon: <ExternalLink className={iconClassName} />, label: t("genra.openGenra"), onClick: () => window.open(GENRA_FRONTEND_URL, "_blank", "noopener") },
        ],
        [{ key: "signout", icon: <LogOut className={iconClassName} />, label: t("genra.signOut"), onClick: () => void signOutGenra() }],
    ];
}

/** User credits balance (same wallet as the editor); clicking opens the pricing page (top-up). */
export function GenraCreditsBadge({ style }: { style?: React.CSSProperties }) {
    const { t } = useTranslation();
    const user = useGenraAuth((state) => state.user);
    const label = useCreditsLabel();
    if (!user) return null;
    return (
        <Tooltip title={t("genra.topUp")}>
            <a
                href={GENRA_PRICING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-200 px-3 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-500 dark:hover:text-white"
                style={style}
            >
                <Coins className="size-3.5" />
                <span className="hidden lg:inline">{label}</span>
            </a>
        </Tooltip>
    );
}

export function GenraAccountMenu() {
    const { t } = useTranslation();
    const session = useGenraAuth((state) => state.session);
    const user = useGenraAuth((state) => state.user);
    const [appActions, signOutActions] = useGenraAccountActions("size-3.5");
    const email = user?.email || "";
    const avatarUrl = typeof user?.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : "";
    if (session === undefined) return <span className="text-xs text-stone-500">{t("genra.signingIn")}</span>;
    if (!user) return null;
    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                items: [{ key: "email", label: <span className="text-xs text-stone-500">{email}</span>, disabled: true }, { type: "divider" }, ...appActions, { type: "divider" }, ...signOutActions],
            }}
        >
            <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 text-xs font-semibold text-stone-800 transition hover:ring-2 hover:ring-stone-300 dark:bg-stone-700 dark:text-stone-100 dark:hover:ring-stone-600"
                aria-label={t("genra.account")}
                title={email}
            >
                {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : (email || "?").slice(0, 1).toUpperCase()}
            </button>
        </Dropdown>
    );
}

/** Mobile drawer footer: credits plus the same actions as the account menu. */
export function GenraAccountDrawerSection({ onAction }: { onAction: () => void }) {
    const user = useGenraAuth((state) => state.user);
    const creditsLabel = useCreditsLabel();
    const [appActions, signOutActions] = useGenraAccountActions("size-5");
    if (!user) return null;
    const rowClassName = "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100";
    return (
        <div className="mt-3 space-y-1 border-t border-stone-200 pt-3 dark:border-stone-800">
            {user.email ? <div className="truncate px-3 pb-1 text-xs text-stone-500">{user.email}</div> : null}
            <a href={GENRA_PRICING_URL} target="_blank" rel="noopener noreferrer" className={rowClassName} onClick={onAction}>
                <Coins className="size-5" />
                <span>{creditsLabel}</span>
            </a>
            {[...appActions, ...signOutActions].map((action) => (
                <button
                    key={action.key}
                    type="button"
                    className={rowClassName}
                    onClick={() => {
                        onAction();
                        action.onClick();
                    }}
                >
                    {action.icon}
                    <span className="text-base">{action.label}</span>
                </button>
            ))}
        </div>
    );
}

/** Version plus the MIT attribution for upstream; the attribution must stay. */
export function GenraAboutModal() {
    const { t } = useTranslation();
    const open = useGenraAboutStore((state) => state.open);
    const setOpen = useGenraAboutStore((state) => state.setOpen);
    return (
        <Modal title={t("genra.about")} open={open} width={360} centered footer={null} onCancel={() => setOpen(false)}>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
                <img src="/genra-logo.png" alt="" className="size-14" />
                <div>
                    <div className="text-base font-semibold">Genra Canvas</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                        {t("genra.aboutVersion", { version: APP_VERSION })}
                        <GenraBetaBadge />
                    </div>
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                    <Trans i18nKey="genra.aboutBasedOn" values={{ author: UPSTREAM_AUTHOR }} components={{ upstream: <a href={UPSTREAM_REPO_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" /> }} />
                </div>
            </div>
        </Modal>
    );
}
