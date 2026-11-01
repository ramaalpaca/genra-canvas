// Genra brand tokens, taken from video_mvp editor_web/src/styles/linear-tokens.css (accent #ED5B1D, cool 220° neutrals).
// Only values live here so upstream's lib/app-theme.ts and lib/canvas-theme.ts stay easy to merge.
// CSS variables for Tailwind / shadcn are in styles/genra-theme.css; keep the two in sync.

export const GENRA_FONT_STACK = '"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

export const genraPalette = {
    light: {
        accent: "#ed5b1d",
        accentHover: "#de4f12",
        surface0: "#ffffff",
        surface1: "#f9fafb",
        surface2: "#f3f4f6",
        text: "#14161a",
        textSecondary: "#6b7280",
        borderSubtle: "#e5e7eb",
        borderDefault: "#d7dae0",
    },
    dark: {
        accent: "#ee652b",
        accentHover: "#f07d4c",
        surface0: "#14161a",
        surface1: "#181b20",
        surface2: "#1d2025",
        text: "#f9fafb",
        textSecondary: "#acb0b9",
        borderSubtle: "#282c34",
        borderDefault: "#333842",
    },
} as const;

export const genraCanvasThemes = {
    light: {
        canvas: {
            background: "#f3f4f6",
            dot: "rgba(20,22,26,.24)",
            line: "rgba(20,22,26,.10)",
            selectionStroke: "#ed5b1d",
            selectionFill: "rgba(237,91,29,.08)",
        },
        node: {
            label: "#545964",
            fill: "#e5e7eb",
            panel: "#ffffff",
            stroke: "#d7dae0",
            activeStroke: "#ed5b1d",
            placeholder: "#9096a2",
            text: "#14161a",
            muted: "#6b7280",
            faint: "#9096a2",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#d7dae0",
            item: "#545964",
            itemHover: "#e5e7eb",
            activeBg: "#e5e7eb",
            activeText: "#14161a",
        },
    },
    dark: {
        canvas: {
            background: "#14161a",
            dot: "rgba(249,250,251,.22)",
            line: "rgba(249,250,251,.09)",
            selectionStroke: "#ee652b",
            selectionFill: "rgba(238,101,43,.12)",
        },
        node: {
            label: "#acb0b9",
            fill: "#21252b",
            panel: "#1d2025",
            stroke: "#333842",
            activeStroke: "#ee652b",
            placeholder: "#858b99",
            text: "#f9fafb",
            muted: "#acb0b9",
            faint: "#5d636f",
        },
        toolbar: {
            panel: "rgba(29,32,37,.96)",
            border: "#333842",
            item: "#acb0b9",
            itemHover: "#282c34",
            activeBg: "#333842",
            activeText: "#f9fafb",
        },
    },
};
