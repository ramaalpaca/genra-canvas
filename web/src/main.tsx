import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import "./styles/genra-theme.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { startGenraSession } from "@/services/genra/channel";
import { GENRA_PRODUCTION_UI } from "@/services/genra/env";
import { GENRA_FONT_STACK } from "@/services/genra/theme";

initAnalytics();
startGenraSession();

if (GENRA_PRODUCTION_UI) document.documentElement.dataset.genraUi = "production";
document.body.style.fontFamily = GENRA_PRODUCTION_UI ? GENRA_FONT_STACK : '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
