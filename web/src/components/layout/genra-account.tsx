// Genra account UI shared by the app header and the canvas page top bar: credits badge + account menu (settings / open Genra / sign out).
import { Coins, ExternalLink, LogOut, Settings2 } from "lucide-react";
import { Dropdown, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { signOutGenra, useGenraAuth } from "@/services/genra/auth";
import { GENRA_FRONTEND_URL } from "@/services/genra/env";
import { GENRA_PRICING_URL, useCreditsBalance } from "@/services/genra/credits";
import { useConfigStore } from "@/stores/use-config-store";

/** User credits balance (same wallet as the editor); clicking opens the pricing page (top-up). */
export function GenraCreditsBadge({ style }: { style?: React.CSSProperties }) {
    const { t } = useTranslation();
    const user = useGenraAuth((state) => state.user);
    const { data, isPending, isError } = useCreditsBalance();
    if (!user) return null;
    const label = isError ? t("genra.creditsUnavailable") : isPending ? t("genra.creditsLoading") : t("genra.credits", { count: Math.floor(data?.total_credits ?? 0) });
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
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const email = user?.email || "";
    const avatarUrl = typeof user?.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : "";
    if (session === undefined) return <span className="text-xs text-stone-500">{t("genra.signingIn")}</span>;
    if (!user) return null;
    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                items: [
                    { key: "email", label: <span className="text-xs text-stone-500">{email}</span>, disabled: true },
                    { type: "divider" },
                    { key: "config", icon: <Settings2 className="size-3.5" />, label: t("navigation.config"), onClick: () => openConfigDialog(false) },
                    { key: "genra", icon: <ExternalLink className="size-3.5" />, label: t("genra.openGenra"), onClick: () => window.open(GENRA_FRONTEND_URL, "_blank", "noopener") },
                    { type: "divider" },
                    { key: "signout", icon: <LogOut className="size-3.5" />, label: t("genra.signOut"), onClick: () => void signOutGenra() },
                ],
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
