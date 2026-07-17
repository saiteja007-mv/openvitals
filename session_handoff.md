# Session Handoff — Health MCP

> **Read this first at the start of every session** for current state and where to resume.
> Detailed 68-item UI checklist lives in `docs/UI-REVIEW-HANDOFF.md`.

_Last updated: 2026-07-16._

## ⚡ Now an MCP server (2026-07-16, branch `mcp-conversion`)
The webapp is being retired — health-mcp now serves its health data as an **MCP server** at `https://health.saitejamothukuri.com/mcp` (Streamable HTTP, **bearer-token** auth, **60 tools** over `db.cjs` + Google-Health reads — expanded 2026-07-16 from 16: all Google-Health data points [sleep/heart/hydration/glucose/SpO2/nutrition/etc., read-only — Google Health has **no write API**], full meals+nutrition+food-search, new **hydration** table/tools, exercise catalog, workout-plan CRUD, reminders, goals, export). Code: `server/mcp.mjs` + the `/mcp` route added to `server/index.cjs`; the SPA is no longer served (React `src/` still in the tree, NOT deleted — physical removal is a pending cleanup). Runs as **systemd user service `health-mcp`** (linger on, `Restart=always`). Token persisted at `.data/mcp-token.txt` (env `HEALTH_MCP_TOKEN` overrides). Backend tests still green (66). Google-OAuth gating is a planned upgrade; today it's bearer-token. Verified end-to-end with a real MCP client over the public URL.

**Direct Google Health (2026-07-16):** `server/openfit.cjs` was rebuilt to call the **Google Health API directly** (live/original data) instead of proxying the old openfit backend on :42813 — that backend is **retired/stopped**. It reuses the shared OAuth client (`~/.hermes/secrets/google-health-client.json`) + a local token copy (`.data/google-health-credentials.json`, gitignored) so **no re-login**; the Google Health service code is vendored at `server/google-health-service.cjs`. Google Health stays read-only. `~/openfit` repo left intact (only its backend process stopped).

## Project at a glance
Single-user health tracker. **React + Vite + TypeScript** front end (`src/`), **node:sqlite** backend (`server/`), Uber/Base-Web **strict-monochrome** design (black/white/greys, Inter, pill buttons, inset-hairline cards — no second accent color).
- Run: `npm run server` (backend) + `npm run dev` (Vite). DB at `.data/health-mcp.sqlite`.
- Verify after edits: `npx tsc --noEmit` (frontend) + `node --test` (backend, 66 tests). Both must stay green. `npx vite build` for a full build check.
- Note: the browser/Chrome tool can't reach `localhost`, so live UI click-through must be done by the user via `npm run dev`.

## Current state
- Branch: **`main`**. There **is** an `origin` remote, but **nothing has been pushed** — all work is local commits. Push only when asked.
- Working tree: only `server/summary.cjs` + `test/summary.test.cjs` are modified — these were **already modified before this session began (not our work)**; left untouched. Decide whether to keep/commit/revert them.
- Everything below is committed and green (tsc + build clean, 66 tests pass; note: one backend test is timing-flaky — rerun if it fails once).

## What shipped this session (all on `main`)
1. **Habit streak = log-to-count** + **Log button** (replaced the checkbox).
2. **Full 68-finding UI review implemented — batches A–K** (see `docs/UI-REVIEW-HANDOFF.md` for the ticked checklist). Highlights: monochrome design-system tokens + `Empty`/`Stat` primitive slots + 44px touch targets; monochrome SVG nav + focus rings; `confirm()` on all destructive actions incl. the backup-restore wipe; Exercises keyboard access + skeletons + load-more; shared `src/components/chart.tsx` (styled Recharts tooltip + palette); Login error semantics + accessible `Modal`/`Toast`; Today stale-while-load (no page collapse) + goal deltas; 5-tab mobile nav; branded boot screen.
3. **Post-review feature work:**
   - Tap a **meal**, a **Lookup product**, or a **meal template** → detail modal with full nutrition (Cals/Protein/Carbs/Fat `Stat` tiles). Lookup products show per-100g + grams-scaled add-to-log. (`src/screens/Food.tsx`)
   - **Fix:** Trends "Weight (kg)" chart now merges the app's own `body_metrics` (manual Body-screen entries) with the Google-Health sync source — previously it only read the sync source so manual weights never showed. Lone data point now renders as a dot. (`src/screens/Trends.tsx`)

## Open / next candidates
- **Consciously deferred UI sub-notes** (optional polish): Trends prev-window Δ (shows `latest · avg` only); Body inline *edit* of history (delete exists); full Modal focus-*trap* (focus-on-open + Escape + restore exist; Tab can still leave).
- Pre-existing `summary.*` changes to resolve.
- Not pushed — offer `git push` / branch cleanup if the user wants it remote.

## Non-Health MCP context from this session
Home-infra: NordVPN + Tailscale coexistence on the Inspiron is PLANNED (see the user's memory `inspiron-nordvpn-tailscale-coexist`), unrelated to this repo.
