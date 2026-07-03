# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What Consied is

Consied is a **single-user health & fitness tracker**. One person runs it on their
own machine, exposes it through a Cloudflare tunnel (behind a password), and uses it
to:

- View Google Health stats (steps, sleep, weight, calories out) pulled from a separate
  **OpenFit** service running on the same host.
- Browse a catalog of **1,324 exercises** (name, muscle group, equipment, instructions,
  images).
- Manually log **workouts** and **meals** (with OpenFoodFacts barcode lookup for macros).
- Track **body metrics**, **habits**, **workout plans**, and get advisory
  **calorie/protein recommendations** and **weekly summaries**.

It is deliberately dependency-light: no web framework, no ORM, no auth library. The
backend is Node stdlib `http` + `node:sqlite`; the frontend is React + Vite.

## Architecture at a glance

```
Browser (React SPA)
   │  fetch /api/*  and  /media/*
   ▼
server/index.cjs  ── Node http server on 127.0.0.1:42815
   ├── serves built SPA from dist/  and images from media/
   ├── /api/*  → routed inline (giant if-chain), gated by a session cookie
   ├── db.cjs        SQLite (node:sqlite) CRUD: workouts, meals, body, habits, plans, …
   ├── exercises.cjs in-memory search over data/exercises.json
   ├── openfit.cjs   proxy → OpenFit service on :42813 (Google Health), last-good cache
   ├── summary/weekly/progress/recommend.cjs  pure computation modules
   ├── food.cjs      OpenFoodFacts barcode lookup + macro math
   ├── reminders.cjs Slack/Telegram reminder delivery
   └── auth.cjs      single-password login + signed session cookie
```

**Single origin in production:** the backend serves both `/api/*` and the static SPA,
so there is no CORS. In dev, Vite (`:5175`) proxies `/api` to the backend (`:42815`).

## Directory layout

```
server/                 CommonJS backend (.cjs). No build step — run directly with node.
  index.cjs             http server, route table, static + /media serving, request wiring
  db.cjs                node:sqlite schema + all persistence (workouts, meals, body,
                        habits, plans, reminders, settings, photos, import/export)
  exercises.cjs         load + filter data/exercises.json in memory
  openfit.cjs           proxy to OpenFit (Google Health) with last-good fallback cache
  food.cjs              OpenFoodFacts lookup + grams→macros calculator
  summary.cjs           pure: day nutrition/calorie-balance/health summary
  weekly.cjs            pure: 7-day rollup + insight text
  progress.cjs          pure: progressive-overload / PR detection per exercise
  recommend.cjs         pure: advisory calorie & protein targets
  reminders.cjs         due-check (pure) + Slack/Telegram delivery (I/O)
  auth.cjs              password (env or auto-generated) + signed session cookie
  http-helpers.cjs      sendJson / sendHtml / readBody / parseQuery

src/                    React + Vite + TypeScript SPA
  main.tsx App.tsx      entry + top-level routing/nav + auth gate
  api.ts                typed fetch wrapper for every /api endpoint
  types.ts              shared TypeScript types
  theme.css             styling (Uber-inspired, see DESIGN.md)
  components/UI.tsx      shared UI primitives
  screens/              Today, Exercises, Workouts, Food, Body, Trends, Settings, Login

test/                   node:test suites, one per backend module (65 tests)
data/
  exercises.json        committed catalog, 1,324 records (~14 MB)
  _residual.json        the 16 exercises NOT in free-exercise-db (locally generated imgs)
media/
  gen/                  16 generated PNGs for the residual exercises (/media/gen/<id>.png)
docs/superpowers/       original design spec + implementation plan (historical)
DESIGN.md               Uber-inspired design-system spec (colors, type, components)
```

## Running & building

Prerequisites: **Node ≥ 22** (uses the built-in `node:sqlite` module — there is no
`better-sqlite3` dependency despite what older plan docs say).

```bash
npm install          # frontend deps only; backend uses Node stdlib

npm test             # run all backend tests (node --test)
npm run dev          # Vite dev server on https://localhost:5175 (proxies /api → :42815)
npm run server       # backend on http://127.0.0.1:42815 (serves dist/ + /api + /media)
npm run build        # build SPA into dist/
```

Typical local flow: run `npm run server` in one terminal and `npm run dev` in another.
For a production-like check, `npm run build` then `npm run server` and hit `:42815`.

Note: `npm run dev` generates a self-signed TLS cert into `.data/tls/` on first run
(needs `openssl`). HTTPS is required so the camera-based barcode scanner
(`getUserMedia`) works from non-localhost origins.

## Environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `PORT` | Backend listen port | `42815` |
| `CONSIED_DB` | SQLite file path | `.data/consied.sqlite` |
| `CONSIED_PASSWORD` | Login password | auto-generated → `.data/auto-password.txt` (chmod 600) |
| `CONSIED_NO_AUTH` | `1` disables auth — **local dev only** | unset (auth on) |
| `OPENFIT_URL` | Base URL of the OpenFit service | `http://127.0.0.1:42813` |

If `CONSIED_PASSWORD` is unset, the server generates a password on first boot and
writes it to `.data/auto-password.txt`; read that file to log in.

## Conventions

- **Backend is CommonJS `.cjs`, frontend is ESM `.tsx`.** Keep them separate — do not
  add `"type": "module"` or convert server files to ESM.
- **No web framework.** Routing is an explicit `if (p === '…' && m === '…')` chain in
  `server/index.cjs`. Add new endpoints there and return via `sendJson`. The auth gate
  (`if (p.startsWith('/api/') && !auth.authed(req))`) sits near the top — routes below
  it require a valid session; put public routes (login/logout) above it.
- **No ORM.** `db.cjs` uses raw prepared statements over `node:sqlite`'s `DatabaseSync`.
  Schema is created idempotently with `CREATE TABLE IF NOT EXISTS`; new columns are
  added via the `ensureColumn` helper so existing databases migrate in place.
- **Keep pure logic pure.** `summary`, `weekly`, `progress`, `recommend`, and the
  due-check half of `reminders` take plain data and return plain data — no DB or network
  inside them. This is what makes them unit-testable. Preserve that boundary.
- **Fail honest, degrade gracefully.** `openfit.cjs` returns `{ stale: true, data: <last
  good> }` when OpenFit is down rather than erroring; `reminders.cjs` returns
  `skipped_not_configured` instead of faking a send. Follow this pattern — never fake
  success.
- **Exercise images:** most records point `image_url` at the public free-exercise-db on
  GitHub; the 16 in `data/_residual.json` point at locally generated `/media/gen/<id>.png`
  served by the `/media/` route.
- **Advisory, not medical.** `recommend.cjs` output is explicitly non-medical guidance.
  Keep that framing in any user-facing copy you add.

## Testing

- Framework: Node's built-in test runner (`node --test`, invoked via `npm test`). No
  Jest/Vitest.
- One `*.test.cjs` file per backend module in `test/`. `smoke.test.cjs` spins up the
  real server against an in-memory DB (`:memory:`).
- **TDD for non-trivial logic**, especially the pure modules. When you add or change a
  computation in `summary/weekly/progress/recommend/food/reminders`, add or update its
  test. All 65 tests must stay green.
- There is no test runner for the React frontend; verify UI changes by running the app.

## API surface (routes in server/index.cjs)

Auth: `POST /api/login`, `POST /api/logout`, `GET /api/me`.
Health/OpenFit: `GET /api/status`, `GET /api/health`, `POST /api/sync`.
Exercises: `GET /api/exercises`, `GET /api/exercises/facets`, `GET /api/exercises/:id`.
Workouts: `GET/POST /api/workouts`, `PATCH/DELETE /api/workouts/:id`.
Meals: `GET/POST /api/meals`, `POST /api/meals/duplicate`; recipes `GET/POST /api/meal-recipes`.
Body: `GET/POST /api/body`. Habits: `/api/habits`, `/api/habits/status`, `/api/habits/new`.
Plans: `GET/POST /api/workout-plans`. Reminders: `/api/reminders`, `/api/reminders/due`.
Food: `GET /api/food/search`. Settings: `GET/PATCH /api/settings`.
Derived: `GET /api/progress`, `GET /api/recommendation`, `GET /api/weekly`, `GET /api/summary`.
Data: `GET /api/export/json`, `POST /api/import/json`. Static: `/media/*`, SPA fallback.

The typed client for all of these lives in `src/api.ts` — keep it in sync when you add
or change a route.

## Git workflow

- Commit after each self-contained change with a clear, descriptive message.
- Keep `data/exercises.json` and `data/_residual.json` committed (they are the catalog).
  Runtime artifacts are gitignored: `node_modules/`, `dist/`, `.data/`, `*.sqlite`, `*.db`.
