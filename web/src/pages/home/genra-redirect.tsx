// Production `/`: marketing stays on genra.ai, signed-in users land on the canvas list.
// Unauthenticated visitors are already sent to the Genra login page by startGenraSession (services/genra/auth.ts).
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useGenraAuth } from "@/services/genra/auth";

export default function HomeRedirect() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useGenraAuth((state) => state.user);

    useEffect(() => {
        if (user) navigate("/canvas", { replace: true });
    }, [navigate, user]);

    return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;
}
