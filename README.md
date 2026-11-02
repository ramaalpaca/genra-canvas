<p align="center">
  <img src="web/public/genra-logo.png" width="96" alt="Genra Canvas logo">
</p>

<h1 align="center">Genra Canvas</h1>

<p align="center">
  Genra's node-based infinite canvas for AI image, video and text creation — <a href="https://canvas.genra.ai">canvas.genra.ai</a>
</p>

Genra Canvas is a fork of **[infinite-canvas](https://github.com/basketikun/infinite-canvas)** by [basketikun](https://github.com/basketikun) (MIT License), pinned to upstream `v0.20.0`. The canvas editor, node system, plugin SDK, prompt library and local IndexedDB persistence are upstream code; this fork wires the app to a Genra account instead of user-supplied API keys.

> 本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT 协议）二次开发。按上游作者的要求，保留原作者信息与页面标识（版本弹窗署名、GitHub 链接），[LICENSE](LICENSE) 原样保留。上游 README 见 [`docs/`](docs/) 与上游仓库。

## What this fork changes

| Area | Change |
|---|---|
| Sign-in | `web/src/services/genra/auth.ts`: supabase-js session shared with genra.ai through a `.genra.ai` cookie (same storage adapter as the Genra editor). Unauthenticated visitors are sent to the Genra login page. |
| Provider | `web/src/services/genra/channel.ts`: after sign-in a locked **Genra** channel is injected — `baseUrl = VITE_GENRA_API_URL + /openai`, `apiKey = the user's JWT`, models from `GET /openai/v1/models` (alias ids such as `nano-banana-pro` / `veo`, with `genra.credits_pricing`) grouped by `genra.capability`. The apiKey follows every token refresh. |
| Pricing | `web/src/services/genra/pricing.ts` keeps each model's `genra.credits_pricing` (persisted on the channel models) and mirrors the backend formula. The model picker shows unit prices, generate buttons show "≈ N credits" with a low-balance hint that never blocks. `credits-events.ts` watches responses for the toast after a charge and rewrites 402 errors into a top-up prompt. |
| Credits | `web/src/services/genra/credits.ts` + top bar badge reading `/api/v1/user/subscription/status` (`total_credits`, same wallet as the editor); click goes to Genra pricing. |
| Hidden UI | Provider / local proxy / WebDAV settings tabs, config import/export, the local Canvas Agent (Codex / Claude Code) panel and buttons. All behind switches in `web/src/services/genra/env.ts` (`VITE_GENRA_CHANNEL_LOCKED`, `VITE_GENRA_LOCAL_AGENT`). |
| Production UI | `VITE_GENRA_PRODUCTION_UI` (default `true`) hides the upstream self-hosting entry points: GitHub / docs links, version modal, node plugins (URL install) and the toolbar "extensions" button, language switch, the marketing home page (`/` → `/canvas` when signed in), "delete all" on the canvas list (zip import/export move to the canvas menu → More), and the settings nav item (now in the account menu, with an About dialog carrying the version and MIT attribution). Settings keep Preferences, Prompt sources and Cache; the canvas list shows a dismissible local-data notice. Production builds also drop `model-script-editor` and the plugin manager from the bundle. Set it to `false` in `web/.env.local` to debug the upstream UI. |
| Access gate | `web/src/services/genra/access.ts` asks `GET /api/v1/canvas/access` after sign-in and keeps the answer in memory. Only an explicit `enabled` renders the app (`components/layout/genra-access-gate.tsx`): `disabled` shows the private-beta page, and network errors or a 404 show a retry page. A 403 `canvas_not_enabled` on any fetch or axios request switches to the beta page. Cloud sync starts only when enabled. `VITE_GENRA_ACCESS_GATE=false` skips the check, which local development needs until the backend has the endpoint. |
| Cloud sync | Canvases and the images, videos and audio they reference sync to the Genra backend (`/api/v1/canvas`). `web/src/services/genra/cloud-sync-planner.ts` decides, `cloud-sync-engine.ts` runs a cycle, `cloud-sync-client.ts` is the REST layer, `cloud-sync.ts` does the scheduling. Upstream files only gain `setRemoteImageResolver` / `setRemoteMediaResolver` and a reload token on the canvas page. My Assets and studio history stay local. `VITE_GENRA_CLOUD_SYNC=false` turns it off. |
| Dev sign-in | localhost doesn't share the `.genra.ai` cookie: run `GENRA_DEV_JWT_FILE=<jwt file> bun run dev` and open `/__genra/dev-login` (dev server only). |
| Removed | `canvas-agent/`, `canvas-proxy/`, `plugins/infinite-canvas` (Codex app plugin), upstream GitHub workflows (Docker image, docs pages, plugin publishing). |
| Branding | Title / icon / OG meta; palette, radii and font follow the Genra editor (accent `#ED5B1D`). Values in `web/src/services/genra/theme.ts` and `web/src/styles/genra-theme.css`, which re-points Tailwind's `stone-*` scale under `<html data-genra-ui>`. `VERSION` is Genra's own version (from 1.0.0). Locale follows genra.ai via `?lang=<code>` on links from the main site (persisted), then the browser language — `zh*` → zh-CN, everything else → en-US. |
| Deploy | `.github/workflows/deploy.yml` → Cloudflare Pages project `genra-canvas` on pushes to `production`. |

Hook points in upstream files are kept small so upstream can be merged: `stores/use-config-store.ts`, `components/layout/app-config-modal.tsx`, `components/layout/app-top-nav.tsx`, `components/canvas/canvas-top-bar.tsx`, `layouts/user-layout.tsx`, `components/layout/version-release-modal.tsx`, `hooks/use-version-check.ts`, `i18n/`, `main.tsx`, `index.html`, `lib/app-theme.ts`.

TODO (next iterations): "Add to Genra project" node action and a "Genra project assets" tab in the asset picker; cloud sync of canvases; main-site `/login` honouring the `redirect` parameter so users come straight back to the canvas.

## Local development

Requires [bun](https://bun.sh) and a Genra backend that exposes the OpenAI-compatible facade (`video_mvp` → `scripts/dev-backend.sh`, port 8000).

```bash
cd web
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
bun install
bun run dev                  # http://localhost:3000
```

`bun run typecheck` and `bun run build` must pass before opening a PR.

Sign-in for local development: the session cookie is host-only on `localhost`, so either sign in on a locally running Genra main site (`VITE_FRONTEND_URL=http://localhost:<port>`), or run the canvas on a `*.genra.ai` dev host so the production cookie is shared.

## Syncing with upstream

```bash
git fetch upstream --tags
git merge v0.21.0   # or the next upstream tag
```

Resolve conflicts in the hook-point files listed above; everything Genra-specific lives in `web/src/services/genra/`.

## License

[MIT](LICENSE) — copyright notice of the original author retained.
