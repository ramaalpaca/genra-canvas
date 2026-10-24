import { Bot, Coins, ExternalLink, LogOut, Menu } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { signOutGenra, useGenraAuth } from "@/services/genra/auth";
import { GENRA_FRONTEND_URL, GENRA_LOCAL_AGENT_ENABLED } from "@/services/genra/env";
import { GENRA_PRICING_URL, usePointsBalance } from "@/services/genra/points";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (!GENRA_LOCAL_AGENT_ENABLED || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/genra-logo.png) center / contain no-repeat",
                                        WebkitMask: "url(/genra-logo.png) center / contain no-repeat",
                                    }}
                                />
                                <span className="text-base font-medium">{t("meta.title")}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-8 hidden h-14 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <GenraPointsBadge />
                            {GENRA_LOCAL_AGENT_ENABLED ? (
                                <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                                </Tooltip>
                            ) : null}
                            <UserStatusActions />
                            <GenraAccountMenu />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}

/** Points balance from Genra; clicking opens the pricing page (top-up). */
function GenraPointsBadge() {
    const { t } = useTranslation();
    const user = useGenraAuth((state) => state.user);
    const { data, isPending, isError } = usePointsBalance();
    if (!user) return null;
    const label = isError ? t("genra.pointsUnavailable") : isPending ? t("genra.pointsLoading") : t("genra.points", { count: Math.floor(data?.points_balance ?? 0) });
    return (
        <Tooltip title={t("genra.topUp")}>
            <a
                href={GENRA_PRICING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-200 px-3 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-500 dark:hover:text-white"
            >
                <Coins className="size-3.5" />
                <span className="hidden lg:inline">{label}</span>
            </a>
        </Tooltip>
    );
}

function GenraAccountMenu() {
    const { t } = useTranslation();
    const session = useGenraAuth((state) => state.session);
    const user = useGenraAuth((state) => state.user);
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
                    { key: "genra", icon: <ExternalLink className="size-3.5" />, label: t("genra.openGenra"), onClick: () => window.open(GENRA_FRONTEND_URL, "_blank", "noopener") },
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
