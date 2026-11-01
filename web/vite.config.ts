import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

// Genra dev sign-in: localhost doesn't share the `.genra.ai` session cookie, so start the dev server with
// `GENRA_DEV_JWT_FILE=/path/to/jwt` (e.g. video_mvp's current_jwt.txt from scripts/admin-jwt.sh) and open
// http://localhost:3000/__genra/dev-login — it writes a supabase-js session for that JWT into localStorage and goes to `/`.
// Dev server only (`apply: "serve"`), never part of a build; the token itself never enters the repo.
function genraDevLogin(supabaseUrl: string): Plugin {
    return {
        name: "genra-dev-login",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/__genra/dev-login", (_req, res) => {
                const file = process.env.GENRA_DEV_JWT_FILE;
                res.setHeader("Cache-Control", "no-store");
                if (!file || !supabaseUrl) {
                    res.statusCode = 404;
                    res.end("Start the dev server with GENRA_DEV_JWT_FILE=<jwt file> and VITE_SUPABASE_URL set.");
                    return;
                }
                const token = readFileSync(file, "utf8")
                    .trim()
                    .replace(/^Bearer\s+/i, "");
                const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
                const expiresAt = Number(payload.exp) || Math.floor(Date.now() / 1000) + 3600;
                const session = {
                    access_token: token,
                    refresh_token: "genra-dev-login",
                    token_type: "bearer",
                    expires_at: expiresAt,
                    expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
                    user: { id: payload.sub, aud: payload.aud || "authenticated", role: payload.role || "authenticated", email: payload.email, app_metadata: payload.app_metadata || {}, user_metadata: payload.user_metadata || {}, created_at: "" },
                };
                const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(`<!doctype html><title>Genra dev login</title><script>localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))});location.replace("/");</script>`);
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    // Genra: read VITE_* from .env files too so `VITE_GENRA_PRODUCTION_UI=false` in web/.env.local works for local debugging.
    const env = { ...loadEnv(mode, webDir, "VITE_"), ...process.env };
    return {
        base: process.env.VITE_BASE || "/",
        plugins: [react(), localPluginsManifest(), genraDevLogin(env.VITE_SUPABASE_URL || "")],
        resolve: {
            alias: {
                "@": resolve(webDir, "src"),
            },
        },
        define: {
            __APP_VERSION__: JSON.stringify(localVersion),
            __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
            // Boolean literal (not a string) so Rollup can drop the hidden upstream UI and its lazy chunks from production builds.
            __GENRA_PRODUCTION_UI__: env.VITE_GENRA_PRODUCTION_UI !== "false",
        },
    };
});
