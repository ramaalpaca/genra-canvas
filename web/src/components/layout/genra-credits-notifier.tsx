// Toasts for credits: what a generation cost, and what to do when the balance runs out.
import { useEffect, useRef } from "react";
import { App, Button } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { GENRA_TOP_UP_URL, type SubscriptionStatus } from "@/services/genra/credits";
import { useCreditsEvents } from "@/services/genra/credits-events";
import { formatCredits } from "@/services/genra/pricing";

export function GenraCreditsNotifier() {
    const { t } = useTranslation();
    const { message, notification } = App.useApp();
    const queryClient = useQueryClient();
    const charge = useCreditsEvents((state) => state.charge);
    const insufficientSequence = useCreditsEvents((state) => state.insufficientSequence);
    const shownInsufficient = useRef(0);

    useEffect(() => {
        if (!charge) return;
        const cost = formatCredits(charge.cost);
        void message.info(charge.balance === undefined ? t("genra.pricing.charged", { cost }) : t("genra.pricing.chargedWithBalance", { cost, balance: formatCredits(charge.balance) }));
        // Show the response's balance straight away, then confirm it with the server.
        const { balance } = charge;
        if (balance !== undefined) queryClient.setQueriesData<SubscriptionStatus>({ queryKey: ["genra", "credits"] }, (current) => (current ? { ...current, total_credits: balance } : current));
        void queryClient.invalidateQueries({ queryKey: ["genra", "credits"] });
    }, [charge, message, queryClient, t]);

    useEffect(() => {
        if (!insufficientSequence || insufficientSequence === shownInsufficient.current) return;
        shownInsufficient.current = insufficientSequence;
        notification.warning({
            title: t("genra.pricing.insufficientTitle"),
            description: t("genra.pricing.insufficientDescription"),
            actions: (
                <Button type="primary" size="small" href={GENRA_TOP_UP_URL} target="_blank" rel="noopener noreferrer">
                    {t("genra.pricing.topUp")}
                </Button>
            ),
            duration: 10,
        });
        void queryClient.invalidateQueries({ queryKey: ["genra", "credits"] });
    }, [insufficientSequence, notification, queryClient, t]);

    return null;
}
