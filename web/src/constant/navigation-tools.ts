import { FileText, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";

import { GENRA_PRODUCTION_UI } from "@/services/genra/env";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

/** Genra production UI: settings live in the account menu, not the nav. */
export const visibleNavigationTools: readonly (typeof navigationTools)[number][] = GENRA_PRODUCTION_UI ? navigationTools.filter((tool) => tool.slug !== "config") : navigationTools;
