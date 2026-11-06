// Small "Beta" mark beside the Genra Canvas name. Kept quiet on purpose: an outline in the surrounding text colour.
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { GENRA_PRODUCTION_UI } from "@/services/genra/env";

export function GenraBetaBadge({ className, style }: { className?: string; style?: CSSProperties }) {
    if (!GENRA_PRODUCTION_UI) return null;
    return (
        <span className={cn("inline-flex h-4 shrink-0 items-center rounded border border-current px-1 text-[10px] font-medium leading-none tracking-wide opacity-55", className)} style={style}>
            Beta
        </span>
    );
}
