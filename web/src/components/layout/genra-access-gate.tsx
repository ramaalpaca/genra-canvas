// Allowlist gate around the whole app. Only an explicit "enabled" renders the canvas.
import type { ReactNode } from "react";
import { Button, Spin } from "antd";
import { useTranslation } from "react-i18next";

import { recheckCanvasAccess, useCanvasAccess } from "@/services/genra/access";
import { useGenraAuth } from "@/services/genra/auth";
import { GENRA_FRONTEND_URL } from "@/services/genra/env";

const SUPPORT_EMAIL = "support@genra.ai";

function GatePage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <main className="flex h-dvh items-center justify-center bg-background px-6 text-foreground">
            <section className="flex w-full max-w-md flex-col items-center gap-3 text-center">
                <span
                    className="size-12 bg-current"
                    style={{
                        mask: "url(/genra-logo.png) center / contain no-repeat",
                        WebkitMask: "url(/genra-logo.png) center / contain no-repeat",
                    }}
                />
                <h1 className="pt-3 text-2xl font-semibold">{title}</h1>
                <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
                <div className="flex flex-wrap justify-center gap-3 pt-5">{children}</div>
            </section>
        </main>
    );
}

function BetaPage() {
    const { t } = useTranslation();
    const email = useGenraAuth((state) => state.user?.email) ?? "";
    const subject = encodeURIComponent(t("genra.access.requestSubject", { email }));
    return (
        <GatePage title={t("genra.access.betaTitle")} description={t("genra.access.betaDescription")}>
            <Button type="primary" size="large" href={GENRA_FRONTEND_URL}>
                {t("genra.access.backToGenra")}
            </Button>
            <Button size="large" href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}>
                {t("genra.access.requestAccess")}
            </Button>
        </GatePage>
    );
}

function UnreachablePage() {
    const { t } = useTranslation();
    return (
        <GatePage title={t("genra.access.unreachableTitle")} description={t("genra.access.unreachableDescription")}>
            <Button type="primary" size="large" onClick={() => void recheckCanvasAccess()}>
                {t("genra.access.retry")}
            </Button>
        </GatePage>
    );
}

export function GenraAccessGate({ children }: { children: ReactNode }) {
    const status = useCanvasAccess((state) => state.status);
    if (status === "enabled") return children;
    return (
        <>
            {/* Requests already in flight fail right after access is revoked; keep their error toasts off the gate. */}
            <style>{".ant-message, .ant-notification { display: none !important; }"}</style>
            {status === "disabled" ? (
                <BetaPage />
            ) : status === "unreachable" ? (
                <UnreachablePage />
            ) : (
                <main className="flex h-dvh items-center justify-center bg-background">
                    <Spin size="large" />
                </main>
            )}
        </>
    );
}
