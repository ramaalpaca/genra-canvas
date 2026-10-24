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
