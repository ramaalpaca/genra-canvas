import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

/** Map any language tag (genra.ai route code `zh`, BCP 47 `zh-Hant-TW`, i18next `zh-CN`…) onto the two locales the canvas ships. */
export function toAppLocale(tag: string | null | undefined): AppLocale | null {
    const value = (tag || "").trim().toLowerCase();
    if (!value) return null;
    if (value.startsWith("zh")) return "zh-CN";
    if (value.startsWith("en")) return "en-US";
    return null;
}

/**
 * Genra: the language follows genra.ai, which keeps it in the URL path (`/zh/...`) rather than a cookie, so links from the
 * main site carry it as `?lang=<code>`. Priority: `?lang=` (persisted) → previously saved locale → browser languages → en-US.
 * Languages the canvas doesn't ship (es, ja, …) fall back to English.
 */
export function resolveInitialLocale(): AppLocale {
    // Non-browser (bun test): keep upstream behaviour, saved locale or English.
    if (typeof window === "undefined") return toAppLocale(localStorage.getItem(LOCALE_STORAGE_KEY)) || "en-US";
    const fromUrl = toAppLocale(new URLSearchParams(window.location.search).get("lang"));
    if (fromUrl) {
        localStorage.setItem(LOCALE_STORAGE_KEY, fromUrl);
        return fromUrl;
    }
    const saved = toAppLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
    if (saved) return saved;
    for (const language of navigator.languages || [navigator.language]) {
        const locale = toAppLocale(language);
        if (locale) return locale;
    }
    return "en-US";
}

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
    },
    lng: resolveInitialLocale(),
    fallbackLng: "en-US",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
