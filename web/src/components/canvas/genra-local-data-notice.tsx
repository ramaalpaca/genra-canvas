// Canvas list reminder of where data lives. Each message has its own dismissal, remembered per browser,
// so someone who closed the local-only warning still sees once that cloud sync is now on.
import { useState } from "react";
import { Alert } from "antd";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCloudSyncActive } from "@/services/genra/cloud-sync";

const LOCAL_DISMISSED_KEY = "genra-canvas:local-data-notice-dismissed";
const CLOUD_DISMISSED_KEY = "genra-canvas:cloud-sync-notice-dismissed";

function readDismissed(key: string) {
    try {
        return localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

export function GenraLocalDataNotice() {
    const { t } = useTranslation();
    const cloudActive = useCloudSyncActive();
    const dismissedKey = cloudActive ? CLOUD_DISMISSED_KEY : LOCAL_DISMISSED_KEY;
    const [closedKey, setClosedKey] = useState<string | null>(null);
    if (closedKey === dismissedKey || readDismissed(dismissedKey)) return null;
    return (
        <Alert
            type={cloudActive ? "info" : "warning"}
            showIcon
            title={t(cloudActive ? "genra.cloudSync.listNotice" : "genra.localDataListNotice")}
            closable={{
                // antd 6 only renders the close button when closeIcon is set.
                closeIcon: <X className="size-4" />,
                onClose: () => {
                    setClosedKey(dismissedKey);
                    try {
                        localStorage.setItem(dismissedKey, "1");
                    } catch {
                        // Private mode: the notice simply returns on the next visit.
                    }
                },
            }}
        />
    );
}
