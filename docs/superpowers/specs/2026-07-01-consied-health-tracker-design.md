# Consied — Health Tracker · Design Spec

> Date: 2026-07-01 · Status: Approved (design) · Host: ideapad

## 1. Goal
Single-user health tracking web app served on **ideapad**, exposed via Cloudflare tunnel behind Cloudflare Access. It aggregates Google Health (Fitbit) stats from the existing **OpenFit** backend, provides a workout library of **1,324 exercises**, and lets the user log workouts and meals. UI follows the **Uber (Base Web)** design system.

## 2. Locked decisions
- **Architecture:** separate app that consumes OpenFit's HTTP API. OpenFit (`:42813`, `openfit.service`) is left untouched.
- **Meals:** manual entry (name + calories + protein/carbs/fat) in v1.
- **Storage:** SQLite local file on ideapad (`better-sqlite3`).
- **Auth:** Cloudflare Access (email OTP) enforced at the edge.
- **Stack:** React + Vite + TypeScript frontend; Node backend. Single origin — backend serves the built SPA AND proxies OpenFit.
- **Name:** "Consied". **Exercise GIFs:** use each record's `gif_url` (exercisedb CDN) with a placeholder fallback.

## 3. Architecture
```
Browser (React SPA, Uber/Base-Web UI)
      │  one origin
      ▼
Consied backend (Node + SQLite)   ideapad:42815
   ├── serves built frontend (dist/)
   ├── GET  /api/health    -> proxy OpenFit :42813 /api/cached  (Google Health, read-only)
   ├── POST /api/sync      -> proxy OpenFit /api/sync           ("update the data")
   ├── GET  /api/status    -> OpenFit status passthrough + app health
   ├── GET  /api/exercises -> in-memory search over exercises.json (1,324)
   ├── GET  /api/exercises/:id
   ├── CRUD /api/workouts  -> SQLite
   ├── CRUD /api/meals     -> SQLite
   └── GET  /api/summary?date=YYYY-MM-DD -> composed day view + calorie balance
      ▼
Cloudflare tunnel: health.saitejamothukuri.com -> http://localhost:42815
      (behind Cloudflare Access, email-OTP policy for the owner)
```

## 4. Backend (Node, port 42815)
- Thin HTTP server (Node stdlib http or Fastify), `better-sqlite3` for storage.
- Loads `data/exercises.json` into memory at startup; builds simple indexes for search by name / body_part / equipment / target.
- **Proxy** endpoints to OpenFit; if OpenFit is unreachable, `/api/health` returns the last good payload with `{stale:true}` + a 200, never a hard failure that blocks logging.
- OpenFit `/api/cached` contract consumed: `{source,date,generatedAt,endpoints{...},errors[],requestStats}`. Relevant `endpoints`: `activity.summary` (caloriesOut, steps), `heartIntraday`, `heartTrend`, `stepsTrend`, `caloriesTrend`, `sleepTrend`, `metricTrends`, `bodyWeight`, `hrv`, `spo2`, `food`, `water`.

## 5. Data model (SQLite)
```sql
CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id TEXT,            -- FK to exercises.json id (nullable for freeform)
  name TEXT NOT NULL,
  performed_at TEXT NOT NULL,  -- ISO datetime
  sets INTEGER, reps INTEGER, weight_kg REAL, duration_min REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  meal_type TEXT,              -- breakfast|lunch|dinner|snack
  eaten_at TEXT NOT NULL,      -- ISO datetime
  calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workouts_performed ON workouts(performed_at);
CREATE INDEX idx_meals_eaten ON meals(eaten_at);
```

## 6. Exercises catalog
- `data/exercises.json` (1,324) fetched from `hasaneyldrm/exercises-dataset` into the repo.
- Record fields: `id, name, category, body_part, equipment, instructions{en,es,it,tr,ru,zh}, instruction_steps, muscle_group, secondary_muscles, target, image, gif_url, media_id`.
- Read-only; kept in memory. English instructions used by default.

## 7. Frontend screens (Uber / Base Web)
1. **Today** — Google Health stats (steps, calories out, resting HR, sleep, HRV, SpO2, weight) + today's logged workouts & meals + **calories in (meals) vs out (Google Health)** balance card + **Sync** button.
2. **Exercises** — browse/search 1,324 by body_part / equipment / target; detail shows instruction_steps + GIF; "Log this workout".
3. **Workouts** — logged history, add / edit / delete.
4. **Meals** — manual entry (name + kcal/macros), daily totals, history.
5. **Trends** — charts from OpenFit trend data + logged data (steps, weight, HR, sleep, calories in vs out).

## 8. Design system — Uber / Base Web
Produced via the `/design-system` skill at build time. Principles: high contrast, black primary on white, one accent, functional and data-dense, small radii, clear tabular data, minimal charts. Mobile-first responsive (used on phone and desktop).

## 9. Deploy
- `consied.service` (systemd, `User=saiteja`, `Restart=always`) running the Node backend.
- `vite build` -> `dist/` served by the backend (single port 42815).
- Cloudflare tunnel: add ingress `health.saitejamothukuri.com -> http://localhost:42815` in `~/.cloudflared/config.yml`. NOTE: `cloudflared` service is currently **inactive** — must be (re)enabled/installed as a service.
- Cloudflare Access: email-OTP policy on the hostname, allow owner email only.

## 10. Error handling
- OpenFit down -> serve last cached health data with a banner; logging still works (independent SQLite).
- GIF/image 403 (media ownership) -> placeholder fallback.
- SQLite writes atomic (better-sqlite3 transactions).
- Cloudflare Access blocks unauthenticated access at the edge.

## 11. Testing
One smoke self-check (assert-based): exercises search returns hits; workout + meal CRUD round-trip; calorie-balance calc; `/api/summary` composition. No heavy framework.

## 12. Out of scope (v1) / future
Food-database / barcode / photo meal logging; multi-user; self-hosting exercise media; push reminders; PWA offline; writing data back to Google Health.

## 13. Open items / defaults
- Name "Consied" (assumed; rename trivial).
- exercisedb CDN GIF reliability (fallback handles failures).
