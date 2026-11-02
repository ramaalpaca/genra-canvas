// Canvas list reminder until cloud storage ships: data lives in this browser only. Dismissal is remembered per browser.
import { useState } from "react";
import { Alert } from "antd";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

const DISMISSED_KEY = "genra-canvas:local-data-notice-dismissed";

function readDismissed() {
    try {
        return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

export function GenraLocalDataNotice() {
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(readDismissed);
    if (dismissed) return null;
    return (
        <Alert
            type="warning"
            showIcon
            title={t("genra.localDataListNotice")}
            closable={{
                // antd 6 only renders the close button when closeIcon is set.
                closeIcon: <X className="size-4" />,
                onClose: () => {
                    setDismissed(true);
                    try {
                        localStorage.setItem(DISMISSED_KEY, "1");
                    } catch {
                        // Private mode: the notice simply returns on the next visit.
                    }
                },
            }}
        />
    );
}
