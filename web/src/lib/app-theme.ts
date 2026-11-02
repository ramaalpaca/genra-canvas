import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

import { GENRA_PRODUCTION_UI } from "@/services/genra/env";
import { GENRA_FONT_STACK, genraPalette } from "@/services/genra/theme";

type MappingAlgorithm = Extract<NonNullable<ThemeConfig["algorithm"]>, (...args: never[]) => unknown>;

// Genra brand: the editor's accent (#ED5B1D). Links stay neutral on purpose: antd's global `a` rule is unlayered and beats
// Tailwind's text utilities, so a coloured colorLink would paint every nav item; hover carries the accent instead.
const neutral = {
    light: {
        primary: genraPalette.light.accent,
        primaryHover: genraPalette.light.accentHover,
        primaryText: "#ffffff",
        link: genraPalette.light.text,
        elevatedBg: genraPalette.light.surface0,
        itemHoverBg: "rgba(237, 91, 29, 0.06)",
        itemSelectedBg: "rgba(237, 91, 29, 0.1)",
        itemSelectedHoverBg: "rgba(237, 91, 29, 0.14)",
        itemText: genraPalette.light.text,
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        primary: genraPalette.dark.accent,
        primaryHover: genraPalette.dark.accentHover,
        primaryText: "#ffffff",
        link: genraPalette.dark.text,
        elevatedBg: genraPalette.dark.surface2,
        itemHoverBg: "rgba(238, 101, 43, 0.1)",
        itemSelectedBg: "rgba(238, 101, 43, 0.16)",
        itemSelectedHoverBg: "rgba(238, 101, 43, 0.22)",
        itemText: genraPalette.dark.text,
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;
    const palette = dark ? genraPalette.dark : genraPalette.light;
    // Editor radii: buttons 6, cards 12, dialogs 14.
    const genraTokens: ThemeConfig["token"] = GENRA_PRODUCTION_UI
        ? {
              colorBgBase: palette.surface0,
              colorTextBase: palette.text,
              colorBgContainer: dark ? palette.surface1 : palette.surface0,
              colorBorder: palette.borderDefault,
              colorBorderSecondary: palette.borderSubtle,
              borderRadius: 6,
              borderRadiusSM: 4,
              borderRadiusLG: 12,
              fontFamily: GENRA_FONT_STACK,
          }
        : {};

    // antd's dark algorithm remaps seed colours (#ee652b came out as #cd5928), so pin the brand colours after it runs.
    const pinBrandColors: MappingAlgorithm = (_seed, mapToken) => ({
        ...mapToken!,
        colorPrimary: color.primary,
        colorPrimaryHover: color.primaryHover,
        colorPrimaryActive: color.primaryHover,
        colorInfo: color.primary,
        colorLink: color.link,
        colorLinkHover: color.primary,
        colorLinkActive: color.primaryHover,
    });

    return {
        algorithm: [dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, pinBrandColors],
        cssVar: { key: dark ? "genra-canvas-dark" : "genra-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.link,
            colorLinkHover: color.primary,
            colorLinkActive: color.primaryHover,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: color.elevatedBg,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
            ...genraTokens,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            ...(GENRA_PRODUCTION_UI ? { Modal: { borderRadiusLG: 14 } } : {}),
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
