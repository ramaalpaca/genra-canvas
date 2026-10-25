/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
    // ---- Genra (see src/services/genra/env.ts)
    // Genra backend origin, e.g. https://backend.genra.ai or http://localhost:8000
    readonly VITE_GENRA_API_URL?: string;
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    // Main site origin for login / pricing links
    readonly VITE_FRONTEND_URL?: string;
    // "false" exposes the upstream provider / proxy / WebDAV UI again
    readonly VITE_GENRA_CHANNEL_LOCKED?: string;
    // "true" shows the local Canvas Agent UI again
    readonly VITE_GENRA_LOCAL_AGENT?: string;
}
