// Genra integration constants. No imports here: both stores and services depend on this file.

function trimSlash(value: string | undefined) {
    return (value || "").trim().replace(/\/+$/, "");
}

/** Genra backend origin, e.g. https://backend.genra.ai (local: http://localhost:8000). */
export const GENRA_API_URL = trimSlash(import.meta.env.VITE_GENRA_API_URL) || "https://backend.genra.ai";

/** OpenAI-compatible facade base URL; the canvas appends /v1 itself. */
export const GENRA_OPENAI_BASE_URL = `${GENRA_API_URL}/openai`;

/** Main site (login, pricing). */
export const GENRA_FRONTEND_URL = trimSlash(import.meta.env.VITE_FRONTEND_URL) || "https://genra.ai";

export const GENRA_SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").trim();
export const GENRA_SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

/** Fixed id of the auto-injected Genra provider channel. */
export const GENRA_CHANNEL_ID = "genra";
export const GENRA_CHANNEL_NAME = "Genra";

/**
 * v1 decision: only the Genra channel is available; custom providers / own API keys are hidden.
 * Set VITE_GENRA_CHANNEL_LOCKED=false to expose the upstream provider UI again (advanced / debugging).
 */
export const GENRA_CHANNEL_LOCKED = import.meta.env.VITE_GENRA_CHANNEL_LOCKED !== "false";

/** Upstream project this fork is based on. Keep the attribution (MIT + author's request). */
export const UPSTREAM_REPO_URL = "https://github.com/basketikun/infinite-canvas";
export const UPSTREAM_AUTHOR = "basketikun";
export const FORK_REPO_URL = "https://github.com/ramaalpaca/genra-canvas";

/** Local Canvas Agent (Codex / Claude Code over MCP) UI: hidden for Genra; VITE_GENRA_LOCAL_AGENT=true re-enables it. */
export const GENRA_LOCAL_AGENT_ENABLED = import.meta.env.VITE_GENRA_LOCAL_AGENT === "true";

/** Canvas cloud sync (default on); VITE_GENRA_CLOUD_SYNC=false keeps canvases in this browser only. */
export const GENRA_CLOUD_SYNC_ENABLED = import.meta.env.VITE_GENRA_CLOUD_SYNC !== "false";

/**
 * Production UI (default on): hide the upstream self-hosting entry points that Genra users never need —
 * GitHub / docs links, the version modal, node plugins (URL install), the language switch, the marketing home page,
 * the settings nav item (moved into the account menu) and "delete all" on the canvas list.
 * The underlying modules stay in the tree so upstream merges don't conflict; the build-time constant
 * (see vite.config.ts `define`) also lets Rollup drop `model-script-editor` and the plugin manager from production bundles.
 * VITE_GENRA_PRODUCTION_UI=false restores the upstream UI for local debugging.
 * (`typeof` guard: bun test has no Vite `define`; in builds the expression folds to a literal.)
 */
export const GENRA_PRODUCTION_UI: boolean = typeof __GENRA_PRODUCTION_UI__ === "boolean" ? __GENRA_PRODUCTION_UI__ : true;
