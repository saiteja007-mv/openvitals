# Session Handoff — Health MCP

> **Read this first at the start of every session** for current state and where to resume.
> Detailed 68-item UI checklist lives in `docs/UI-REVIEW-HANDOFF.md`.

_Last updated: 2026-09-02._

## 🏋️ Google Health v4 expansion — exercise sessions, raw data-point access, richer nutrition (2026-09-02)
Three agents built this concurrently against a shared spec (`server/google-health-service.cjs` +
`server/googlehealth.cjs`, `server/db.cjs`, `server/mcp.mjs`), all against live discovery-doc + probe data
from this account. Full API reference: [`docs/google-health-api-v4.md`](docs/google-health-api-v4.md).

**What shipped:**
- **Exercise sessions as a first-class object**, cached in a new `gh_exercise_sessions` table:
  `list_exercise_sessions`, `get_exercise_session`, `sync_exercise_sessions`, `export_exercise_tcx`,
  `get_workout_day`. `workouts` gained `session_id` so a logged set can be linked to the Google Health
  session it happened during (`log_workout`/`update_workout`/`list_workouts` all take it).
- **`query_google_health`** — a generic escape hatch over all 42 Google Health v4 data types (`DATA_TYPES`
  in `google-health-service.cjs`), for anything the purpose-built tools don't cover. Rejects write-only
  types with a clear message instead of a raw 400.
- **Nutrition got deeper**: `get_food_log`/`get_nutrition_intake` now carry serving size, fiber, sugar,
  sodium, saturated fat, cholesterol, and a full `nutrients` object (every nutrient Google recorded per
  item), not just cals/protein/carbs/fat. `get_food_log({group_by_meal: true})` buckets by meal type.
- `get_heart` gained `zones` (daily HR-zone minutes), `get_breathing` gained `sleep_stages`
  (per-sleep-stage breathing: deep/light/rem/full, each with bpm/sd/snr).
- Fixed the stale "Google Health has no write API" comment in `mcp.mjs` — see hard facts below.

**Hard facts (don't re-litigate these):**
1. **Google Health v4 is not read-only.** `create`/`patch`/`batchDelete` exist per data type, gated behind
   `*.writeonly` scopes — a *different* scope than the `*.readonly` ones this server's stored token has.
   Writes are genuinely out of reach today only because of which scopes were consented to, not an API gap.
2. **Strength sessions have no exercise names/sets/reps/weights in Google Health, ever** — `exerciseType:
   "WORKOUT"` + `displayName` = muscle group is the entire representation. That data only exists in the
   local `workouts` table; sessions and sets are linked, never merged.
3. **Push subscriptions exist** (`projects.subscribers` / `.subscriptions`) but need a GCP project + the
   `cloud-platform` scope — a heavier, separate consent from the googlehealth.* scopes used today.
4. **The user's Google food catalog** (`food` data type, catalog kind, no time filter) is reachable today
   via `query_google_health({data_type:'food'})` but not yet wired into `search_food`.
5. **Write-only types with no read path at all**: symptoms, moods, menstrual-period, ovulation-test.
   `list`/`reconcile` 400 on these by design — Google's own error says so.

**Open items:**
- Writes into Google Health (log meals/water/weight/moods/symptoms from chat, land in Google Fit) need
  re-auth with writeonly scopes — a product decision, not just code, since this is a public OSS repo
  shipping read-only scopes on purpose.
- Push subscriptions (webhook sync instead of polling) need a GCP project set up for `cloud-platform`.
- Food catalog as a `search_food` source — data's already reachable, just not wired in.
- Per-minute series (active-energy-burned, activity-level, time-in-heart-rate-zone, swim strokes) are
  readable via `query_google_health` today but have no dedicated tool/chart yet.
- TCX → GPX/map conversion for `export_exercise_tcx` output — pure post-processing, no new API access.
- Run `node --test` (full suite) before trusting any of this — see per-file test additions
  (`test/googlehealth.test.cjs`, `test/db.test.cjs`, `test/mcp-tools.test.cjs`).

## 🚀 Product Hunt launch + landing page (2026-08-25)
**OpenVitals launches on Product Hunt Wed 2026-08-26, 12:01am PT.**
Dashboard: <https://www.producthunt.com/products/openvitals/openvitals/prelaunch> — "Reschedule
Launch" changes the date; the listing stays editable after launch.

Listing as submitted: tagline *"Your Google Health data, as an MCP server for your AI"*; tags
Health & Fitness / Developer Tools / Artificial Intelligence; Free + Bootstrapped; solo maker;
4 gallery slides; maker first-comment ending in two open questions (which data source next;
how others handle MCP auth at home).

**Deliberately left undone** — both are the user's call, not defaults to fill in:
- **Shoutouts** (public endorsements of other PH products; PH says they help featuring).
- **Connect with Investors** (a VC-fundraising form).
- Video / Loom.

### Landing page → `gh-pages` branch
<https://saiteja007-mv.github.io/openvitals/> — a single self-contained `index.html` plus
`hero-chat.png` and `favicon.png`, on an **orphan `gh-pages` branch**. Orphan on purpose: `main`
is not what's checked out here and the working tree has uncommitted work (below), so nothing in
this tree was touched. **To edit the site, clone fresh and check out `gh-pages`** — do not build
it from this working tree. Pages is enabled via `gh api repos/.../pages`, source `gh-pages` `/`.

### ⚠️ Logo / trademark
The README banner (`media/openvitals-banner.png`) embeds **Google's Fit/Health heart mark**. That
is fine in a README, but as a third-party product's own identity it implies affiliation and is a
real trademark risk. Everything public-facing (PH thumbnail, site favicon, gallery slide 1) now
uses a **neutral blue hexagon + ECG mark** instead. **The README banner still has Google's mark —
worth swapping.**

Asset pipeline (all in the session scratchpad, not committed): gallery slides authored as one
stacked HTML file, rendered at 2x with headless Chrome, sliced with ImageMagick into 4×2540×1520.
The neutral mark is inline SVG in `mark.html`, rendered the same way.
**PH gotcha:** uploading several gallery files in one go **shuffles their order** — upload one at
a time to control the sequence. Gallery slide 3 is an *illustrative* chat mockup with plausible
numbers, not a screenshot of real data.

## 🗄️ Local Google Health day cache (2026-08-24)
`sync_google_health` was **live passthrough only** — it fetched *today's* date into an in-memory
var (60s TTL) and persisted nothing but a `lastSyncAt` timestamp. Google returns one date per
call and caps trends at a rolling 14 days, so **history older than two weeks was unreachable**
no matter how often you synced, and nothing survived a restart.

Now there is a `gh_daily(date, endpoint, json)` table — one row per endpoint per day,
deliberately schema-less so a new Google endpoint is cached the day it appears instead of being
dropped until someone writes a migration.
- `getHealth(date)` serves any **past** date from disk with **zero API calls**; **today always
  goes live** because today is still accumulating.
- All Google-Health read tools (`get_health`, `get_health_metric`, `get_activity`, `get_heart`,
  `get_sleep`, `get_hydration`) now take an optional `date`.
- New tools: `get_health_cache_status`, `backfill_google_health` (capped at 8 days/call).
- Backfill CLI for long ranges: `node server/backfill-gh.cjs <from> <to> [--force]`, paced at one
  date per ~6.5s (each date ≈ 31 calls against a 300/min limit).
- **Intraday series are not cached** (`heartIntraday`/`stepsIntraday`/`caloriesIntraday`) —
  heartIntraday alone is ~370 KB/day vs ~60 KB for everything else. `get_heart`'s `intraday`
  field is therefore live-only and null for cached past dates. Drop `NO_CACHE_ENDPOINTS` in
  `server/googlehealth.cjs` if minute-resolution history is ever needed.
- Backfilled 2026-06-11 (signup) → today. Note **Google itself has no food log before
  2026-07-09** — that gap is at the source, not in the cache.

## ⚡ Now an MCP server (2026-07-16, branch `mcp-conversion`)
The webapp is being retired — health-mcp now serves its health data as an **MCP server** at `https://health.saitejamothukuri.com/mcp` (Streamable HTTP, **bearer-token** auth, **60 tools** over `db.cjs` + Google-Health reads — expanded 2026-07-16 from 16: all Google-Health data points [sleep/heart/hydration/glucose/SpO2/nutrition/etc., read-only — Google Health has **no write API**], full meals+nutrition+food-search, new **hydration** table/tools, exercise catalog, workout-plan CRUD, reminders, goals, export). Code: `server/mcp.mjs` + the `/mcp` route added to `server/index.cjs`; the SPA is no longer served (React `src/` still in the tree, NOT deleted — physical removal is a pending cleanup). Runs as **systemd user service `health-mcp`** (linger on, `Restart=always`). Token persisted at `.data/mcp-token.txt` (env `HEALTH_MCP_TOKEN` overrides). Backend tests still green (66). Google-OAuth gating is a planned upgrade; today it's bearer-token. Verified end-to-end with a real MCP client over the public URL.

**Direct Google Health (2026-07-16):** `server/openfit.cjs` was rebuilt to call the **Google Health API directly** (live/original data) instead of proxying the old openfit backend on :42813 — that backend is **retired/stopped**. It reuses the shared OAuth client (`~/.hermes/secrets/google-health-client.json`) + a local token copy (`.data/google-health-credentials.json`, gitignored) so **no re-login**; the Google Health service code is vendored at `server/google-health-service.cjs`. Google Health stays read-only. `~/openfit` repo left intact (only its backend process stopped).

## Project at a glance
Single-user health tracker. **React + Vite + TypeScript** front end (`src/`), **node:sqlite** backend (`server/`), Uber/Base-Web **strict-monochrome** design (black/white/greys, Inter, pill buttons, inset-hairline cards — no second accent color).
- Run: `npm run server` (backend) + `npm run dev` (Vite). DB at `.data/health-mcp.sqlite`.
- Verify after edits: `npx tsc --noEmit` (frontend) + `node --test` (backend, 66 tests). Both must stay green. `npx vite build` for a full build check.
- Note: the browser/Chrome tool can't reach `localhost`, so live UI click-through must be done by the user via `npm run dev`.

## Current state
_(branch/remote/working-tree lines re-verified 2026-08-25; the previous "nothing has been pushed"
note was stale — the repo is public and pushed.)_
- Checked out: **`mcp-conversion`**. Branches: `main`, `mcp-conversion`, `ui-review-batches`,
  plus the new **`gh-pages`** (landing page only — unrelated to the app code).
- `origin` = <https://github.com/saiteja007-mv/openvitals.git>, **public**, and pushed
  (`origin/main`, `origin/mcp-conversion`, `origin/gh-pages`). Push app branches only when asked.
- Working tree is **dirty and was left untouched this session** — modified: `server/db.cjs`,
  `server/googlehealth.cjs`, `server/mcp.mjs`, `test/db.test.cjs`, `test/googlehealth.test.cjs`;
  untracked: `server/backfill-gh.cjs`, `media/linkedin/`. Not this session's work — decide whether
  to keep/commit/revert. **Run the tests before trusting them; they were not run this session.**
- Older sections below describe work committed on `main` and were green at the time
  (tsc + build clean, 66 tests; one backend test is timing-flaky — rerun if it fails once).

## What shipped this session (all on `main`)
1. **Habit streak = log-to-count** + **Log button** (replaced the checkbox).
2. **Full 68-finding UI review implemented — batches A–K** (see `docs/UI-REVIEW-HANDOFF.md` for the ticked checklist). Highlights: monochrome design-system tokens + `Empty`/`Stat` primitive slots + 44px touch targets; monochrome SVG nav + focus rings; `confirm()` on all destructive actions incl. the backup-restore wipe; Exercises keyboard access + skeletons + load-more; shared `src/components/chart.tsx` (styled Recharts tooltip + palette); Login error semantics + accessible `Modal`/`Toast`; Today stale-while-load (no page collapse) + goal deltas; 5-tab mobile nav; branded boot screen.
3. **Post-review feature work:**
   - Tap a **meal**, a **Lookup product**, or a **meal template** → detail modal with full nutrition (Cals/Protein/Carbs/Fat `Stat` tiles). Lookup products show per-100g + grams-scaled add-to-log. (`src/screens/Food.tsx`)
   - **Fix:** Trends "Weight (kg)" chart now merges the app's own `body_metrics` (manual Body-screen entries) with the Google-Health sync source — previously it only read the sync source so manual weights never showed. Lone data point now renders as a dot. (`src/screens/Trends.tsx`)

## Open / next candidates
- **Launch day (Aug 26):** answer PH comments; optionally add Shoutouts before midnight PT.
- **Swap Google's heart mark out of the README banner** (see trademark note above).
- **Consciously deferred UI sub-notes** (optional polish): Trends prev-window Δ (shows `latest · avg` only); Body inline *edit* of history (delete exists); full Modal focus-*trap* (focus-on-open + Escape + restore exist; Tab can still leave).
- Pre-existing `summary.*` changes to resolve.
- Not pushed — offer `git push` / branch cleanup if the user wants it remote.

## Non-Health MCP context from this session
Home-infra: NordVPN + Tailscale coexistence on the Inspiron is PLANNED (see the user's memory `inspiron-nordvpn-tailscale-coexist`), unrelated to this repo.
