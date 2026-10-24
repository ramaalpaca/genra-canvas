// Copied from video_mvp editor_web/src/editor/core/integrations/supabase/cookieStorage.ts (keep in sync).
// Cookie-backed storage adapter for Supabase auth session.
// Stores on `.genra.ai` so session is shared between genra.ai and editor.genra.ai.
// Falls back to host-only cookie on localhost / non-genra hosts.
// Migrates existing localStorage sessions on first read (no forced re-login).
//
// Large values (Supabase session JSON is often 3-5 KB) are chunked across multiple
// cookies (`<name>.0`, `<name>.1`, ...) because browsers drop cookies > 4 KB.

const COOKIE_DOMAIN = (() => {
    if (typeof window === "undefined") return undefined;
    const host = window.location.hostname;
    if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined;
    if (host === "genra.ai" || host.endsWith(".genra.ai")) return ".genra.ai";
    return undefined;
})();

const IS_HTTPS = typeof window !== "undefined" && window.location.protocol === "https:";
const MAX_AGE_DAYS = 365;
// Each chunk stays well under the 4 KB per-cookie limit; leaves room for the
// cookie name, attributes, and a little slack.
const CHUNK_SIZE = 3200;
const CHUNK_MARKER = "chunked:";

function buildAttrs(maxAgeSeconds: number): string[] {
    const attrs = [`Path=/`, `Max-Age=${maxAgeSeconds}`, "SameSite=Lax"];
    if (COOKIE_DOMAIN) attrs.push(`Domain=${COOKIE_DOMAIN}`);
    if (IS_HTTPS) attrs.push("Secure");
    return attrs;
}

function writeRawCookie(cookieName: string, encodedValue: string) {
    const attrs = buildAttrs(MAX_AGE_DAYS * 86400);
    document.cookie = `${cookieName}=${encodedValue}; ${attrs.join("; ")}`;
}

function readRawCookie(cookieName: string): string | null {
    const prefix = cookieName + "=";
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (const part of parts) {
        if (part.startsWith(prefix)) return part.substring(prefix.length);
    }
    return null;
}

function clearRawCookie(cookieName: string) {
    const attrs = buildAttrs(0);
    document.cookie = `${cookieName}=; ${attrs.join("; ")}`;
}

// Count any leftover chunks so we can clear them when value shrinks or is removed.
function countExistingChunks(name: string): number {
    const encodedName = encodeURIComponent(name);
    const marker = readRawCookie(encodedName);
    if (marker && marker.startsWith(CHUNK_MARKER)) {
        const n = parseInt(marker.substring(CHUNK_MARKER.length), 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return 0;
}

function writeChunkedCookie(name: string, value: string) {
    const encodedName = encodeURIComponent(name);
    const encodedValue = encodeURIComponent(value);

    // Clear any existing chunks first (in case the new value has fewer chunks).
    const prevChunks = countExistingChunks(name);
    for (let i = 0; i < prevChunks; i++) clearRawCookie(`${encodedName}.${i}`);

    if (encodedValue.length <= CHUNK_SIZE) {
        // Fits in single cookie — no marker needed.
        writeRawCookie(encodedName, encodedValue);
        return;
    }

    // Chunked: marker cookie holds `chunked:<N>`, data cookies are name.0 … name.N-1
    const numChunks = Math.ceil(encodedValue.length / CHUNK_SIZE);
    writeRawCookie(encodedName, `${CHUNK_MARKER}${numChunks}`);
    for (let i = 0; i < numChunks; i++) {
        const chunk = encodedValue.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        writeRawCookie(`${encodedName}.${i}`, chunk);
    }
}

function readChunkedCookie(name: string): string | null {
    const encodedName = encodeURIComponent(name);
    const primary = readRawCookie(encodedName);
    if (primary === null) return null;

    if (primary.startsWith(CHUNK_MARKER)) {
        const numChunks = parseInt(primary.substring(CHUNK_MARKER.length), 10);
        if (!Number.isFinite(numChunks) || numChunks <= 0) return null;
        let combined = "";
        for (let i = 0; i < numChunks; i++) {
            const chunk = readRawCookie(`${encodedName}.${i}`);
            if (chunk === null) return null; // Missing chunk — session corrupt, force re-login.
            combined += chunk;
        }
        try {
            return decodeURIComponent(combined);
        } catch {
            return null;
        }
    }

    try {
        return decodeURIComponent(primary);
    } catch {
        return null;
    }
}

function clearChunkedCookie(name: string) {
    const encodedName = encodeURIComponent(name);
    const prevChunks = countExistingChunks(name);
    for (let i = 0; i < prevChunks; i++) clearRawCookie(`${encodedName}.${i}`);
    clearRawCookie(encodedName);
}

export const cookieStorage = {
    getItem(key: string): string | null {
        if (typeof document === "undefined") return null;
        const fromCookie = readChunkedCookie(key);
        if (fromCookie !== null) return fromCookie;
        try {
            const fromLS = localStorage.getItem(key);
            if (fromLS !== null) {
                writeChunkedCookie(key, fromLS);
                localStorage.removeItem(key);
                return fromLS;
            }
        } catch {
            // localStorage unavailable (e.g. disabled); ignore
        }
        return null;
    },
    setItem(key: string, value: string): void {
        if (typeof document === "undefined") return;
        writeChunkedCookie(key, value);
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    },
    removeItem(key: string): void {
        if (typeof document === "undefined") return;
        clearChunkedCookie(key);
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    },
};
