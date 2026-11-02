// Sync status badge for the canvas list and canvas page, plus the toasts raised by background sync.
import { useEffect, type CSSProperties } from "react";
import { App, Tooltip } from "antd";
import { Cloud, CloudOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { takeCloudSyncNotices, useCloudSyncStatus, type CloudSyncPhase } from "@/services/genra/cloud-sync";

const phaseIcons: Record<Exclude<CloudSyncPhase, "disabled">, typeof Cloud> = { syncing: LoaderCircle, synced: Cloud, offline: CloudOff, error: TriangleAlert };

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function GenraCloudSyncBadge({ style }: { style?: CSSProperties }) {
    const { i18n, t } = useTranslation();
    const phase = useCloudSyncStatus((state) => state.phase);
    const lastSyncedAt = useCloudSyncStatus((state) => state.lastSyncedAt);
    const usage = useCloudSyncStatus((state) => state.usage);
    if (phase === "disabled") return null;

    const Icon = phaseIcons[phase];
    const label = t(`genra.cloudSync.phase.${phase}`);
    return (
        <Tooltip
            title={
                <div className="space-y-0.5 text-xs">
                    <div>{lastSyncedAt ? t("genra.cloudSync.lastSynced", { time: new Date(lastSyncedAt).toLocaleString(i18n.language) }) : t("genra.cloudSync.neverSynced")}</div>
                    {usage ? <div>{t("genra.cloudSync.usage", { used: formatBytes(usage.bytes_used), limit: formatBytes(usage.bytes_limit) })}</div> : null}
                    {phase === "offline" || phase === "error" ? <div>{t("genra.cloudSync.willRetry")}</div> : null}
                </div>
            }
        >
            <span className="inline-flex h-8 shrink-0 cursor-default items-center gap-1.5 px-1 text-xs text-stone-500 dark:text-stone-400" style={style} aria-label={label}>
                <Icon className={phase === "syncing" ? "size-3.5 animate-spin" : "size-3.5"} />
                <span className="hidden lg:inline">{label}</span>
            </span>
        </Tooltip>
    );
}

export function GenraCloudSyncNotifier() {
    const { t } = useTranslation();
    const { notification } = App.useApp();
    const pending = useCloudSyncStatus((state) => state.notices.length);

    useEffect(() => {
        if (!pending) return;
        for (const notice of takeCloudSyncNotices()) {
            const { kind, ...values } = notice;
            notification.warning({ title: t(`genra.cloudSync.notices.${kind}.title`), description: t(`genra.cloudSync.notices.${kind}.description`, values), duration: 10 });
        }
    }, [notification, pending, t]);

    return null;
}
