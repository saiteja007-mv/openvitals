# Consied Health Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-user health tracker on ideapad that shows Google Health stats (via OpenFit), a 1,324-exercise library, and manual workout + meal logging, in an Uber/Base-Web UI, tunneled via Cloudflare behind Access.

**Architecture:** A Node backend (`better-sqlite3`) on `:42815` serves a built React/Vite SPA from one origin, proxies OpenFit (`:42813`) for read-only Google Health data, serves the in-memory exercises catalog, and does CRUD for workouts/meals in SQLite. Deployed as `consied.service`; exposed at `health.saitejamothukuri.com` behind Cloudflare Access.

**Tech Stack:** Node (CommonJS `.cjs`) + `better-sqlite3`; React + Vite + TypeScript; charts via `recharts`; systemd; cloudflared.

## Global Constraints
- Node runtime: `/home/saiteja/.nvm/versions/node/v25.1.0/bin/node` (same as openfit.service).
- Backend port **42815**, bind `127.0.0.1` only (Cloudflare tunnel fronts it).
- Single origin: backend serves `dist/` AND `/api/*`. No CORS in prod.
- Only new backend dependency: `better-sqlite3`. No web framework — Node stdlib `http` + helpers.
- OpenFit base URL: `http://127.0.0.1:42813` (env `OPENFIT_URL`).
- SQLite file: `/home/saiteja/consied/.data/consied.sqlite` (env `CONSIED_DB`).
- Exercises JSON: `/home/saiteja/consied/data/exercises.json` (committed, 1,324 records).
- Vite dev server port 5175; production is static `dist/`.
- UI: Uber / Base Web via `/design-system` skill (Task 8). Mobile-first responsive.
- Commit after every task. TDD for non-trivial logic.

---

## File Structure
```
consied/
  data/exercises.json            # committed catalog (1,324)
  .data/consied.sqlite           # runtime DB (gitignored)
  server/
    index.cjs                    # http server, routing, static serving, wiring
    db.cjs                       # SQLite init + workouts/meals CRUD
    exercises.cjs                # load + search catalog (in memory)
    openfit.cjs                  # proxy to OpenFit + last-good cache
    summary.cjs                  # pure day-summary + calorie-balance
    http-helpers.cjs             # sendJson/sendHtml/readBody/parseQuery
  test/
    http-helpers.test.cjs db.test.cjs exercises.test.cjs summary.test.cjs smoke.test.cjs
  src/                           # React app (Vite)
    main.tsx App.tsx api.ts types.ts
    theme/*                      # Uber tokens (from /design-system)
    components/*                 # shared UI (from /design-system)
    screens/Today.tsx Exercises.tsx Workouts.tsx Meals.tsx Trends.tsx
  package.json tsconfig.json vite.config.ts index.html
  deploy/consied.service
```

---

## Task 1: Backend scaffold + http helpers

**Files:** Create `package.json`, `server/http-helpers.cjs`, `test/http-helpers.test.cjs`

**Interfaces — Produces:** `sendJson(res,status,obj)`, `sendHtml(res,status,html)`, `readBody(req)->Promise<object>`, `parseQuery(reqUrl)->URLSearchParams`

- [ ] **Step 1: package.json**
```json
{
  "name": "consied", "version": "0.1.0", "private": true,
  "scripts": { "server": "node server/index.cjs", "test": "node --test", "dev": "vite", "build": "tsc -b && vite build" },
  "dependencies": { "better-sqlite3": "^11.8.0" }
}
```
- [ ] **Step 2: install** — Run: `cd /home/saiteja/consied && npm install better-sqlite3` — Expected: native build succeeds on Linux.
- [ ] **Step 3: write test/http-helpers.test.cjs**
```js
const { test } = require('node:test'); const assert = require('node:assert')
const { parseQuery } = require('../server/http-helpers.cjs')
test('parseQuery reads params', () => {
  const q = parseQuery('http://x/api/exercises?q=push&limit=5')
  assert.equal(q.get('q'), 'push'); assert.equal(q.get('limit'), '5')
})
```
- [ ] **Step 4: run — fails** — `node --test test/http-helpers.test.cjs` — Expected FAIL (module not found)
- [ ] **Step 5: write server/http-helpers.cjs**
```js
function sendJson(res, status, obj) { const b = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json' }); res.end(b) }
function sendHtml(res, status, html) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(html) }
function readBody(req) { return new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch { resolve({}) } }) }) }
function parseQuery(reqUrl) { return new URL(reqUrl, 'http://127.0.0.1').searchParams }
module.exports = { sendJson, sendHtml, readBody, parseQuery }
```
- [ ] **Step 6: run — passes** — `node --test test/http-helpers.test.cjs` — Expected PASS
- [ ] **Step 7: commit** — `git add -A && git commit -m "feat(consied): backend scaffold + http helpers"`

---

## Task 2: SQLite storage (workouts + meals)

**Files:** Create `server/db.cjs`, `test/db.test.cjs`

**Interfaces — Produces:**
- `initDb(path)` creates schema idempotently, sets module singleton.
- `createWorkout({exercise_id?,name,performed_at,sets?,reps?,weight_kg?,duration_min?,notes?}) -> Workout`
- `listWorkouts({from?,to?}) -> Workout[]` (bounds on performed_at, newest first)
- `updateWorkout(id,patch) -> Workout`  ·  `deleteWorkout(id) -> {deleted:boolean}`
- `createMeal({name,meal_type?,eaten_at,calories?,protein_g?,carbs_g?,fat_g?,notes?}) -> Meal`
- `listMeals({from?,to?}) -> Meal[]`  ·  `updateMeal(id,patch) -> Meal`  ·  `deleteMeal(id) -> {deleted:boolean}`

- [ ] **Step 1: write test/db.test.cjs**
```js
const { test, beforeEach } = require('node:test'); const assert = require('node:assert')
const db = require('../server/db.cjs')
beforeEach(() => { db.initDb(':memory:') })
test('workout CRUD round-trip', () => {
  const w = db.createWorkout({ name: 'Squat', performed_at: '2026-07-01T10:00:00', sets: 3, reps: 5, weight_kg: 60 })
  assert.ok(w.id); assert.equal(w.name, 'Squat')
  assert.equal(db.listWorkouts({}).length, 1)
  const u = db.updateWorkout(w.id, { reps: 8 }); assert.equal(u.reps, 8)
  assert.equal(db.deleteWorkout(w.id).deleted, true)
  assert.equal(db.listWorkouts({}).length, 0)
})
test('meal CRUD + date filter', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300, protein_g: 10 })
  db.createMeal({ name: 'Old', eaten_at: '2026-06-01T08:00:00', calories: 100 })
  assert.equal(db.listMeals({ from: '2026-07-01', to: '2026-07-02' }).length, 1)
})
```
- [ ] **Step 2: run — fails** — `node --test test/db.test.cjs` — Expected FAIL
- [ ] **Step 3: write server/db.cjs** (schema per spec §5; column-safe insert/update; date-bounded list; row-delete returns changes>0). Use `better-sqlite3`, `journal_mode=WAL`, `CREATE TABLE IF NOT EXISTS` for `workouts` and `meals` with the columns from the spec, indexes on `performed_at` and `eaten_at`. Whitelist columns per table; parameterized statements only. Export the 9 functions from Interfaces.
- [ ] **Step 4: run — passes** — `node --test test/db.test.cjs` — Expected PASS (both)
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(consied): sqlite storage for workouts+meals"`

> Reference implementation for db.cjs (use verbatim):
```js
const Database = require('better-sqlite3'); const fs = require('node:fs'); const path = require('node:path')
let db = null
function initDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new Database(file); db.pragma('journal_mode = WAL')
  db.exec("CREATE TABLE IF NOT EXISTS workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT, name TEXT NOT NULL, performed_at TEXT NOT NULL, sets INTEGER, reps INTEGER, weight_kg REAL, duration_min REAL, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, meal_type TEXT, eaten_at TEXT NOT NULL, calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_workouts_performed ON workouts(performed_at); CREATE INDEX IF NOT EXISTS idx_meals_eaten ON meals(eaten_at);")
  return db
}
const cols = (t) => t === 'workouts' ? ['exercise_id','name','performed_at','sets','reps','weight_kg','duration_min','notes'] : ['name','meal_type','eaten_at','calories','protein_g','carbs_g','fat_g','notes']
function insert(table, obj) { const c = cols(table).filter((k) => obj[k] !== undefined); const info = db.prepare("INSERT INTO " + table + " (" + c.join(',') + ") VALUES (" + c.map((k)=>'@'+k).join(',') + ")").run(Object.fromEntries(c.map((k)=>[k,obj[k]]))); return db.prepare("SELECT * FROM " + table + " WHERE id=?").get(info.lastInsertRowid) }
function list(table, field, o) { const { from, to } = o || {}; let sql = "SELECT * FROM " + table; const p = []; if (from) { sql += " WHERE " + field + " >= ?"; p.push(from) } if (to) { sql += (from ? " AND " : " WHERE ") + field + " < ?"; p.push(to) } sql += " ORDER BY " + field + " DESC"; return db.prepare(sql).all(...p) }
function update(table, id, patch) { const c = cols(table).filter((k) => patch[k] !== undefined); if (c.length) db.prepare("UPDATE " + table + " SET " + c.map((k)=>k+'=@'+k).join(',') + " WHERE id=@id").run({ ...Object.fromEntries(c.map((k)=>[k,patch[k]])), id }); return db.prepare("SELECT * FROM " + table + " WHERE id=?").get(id) }
function remove(table, id) { return { deleted: db.prepare("DELETE FROM " + table + " WHERE id=?").run(id).changes > 0 } }
module.exports = { initDb, createWorkout:(w)=>insert('workouts',w), listWorkouts:(f)=>list('workouts','performed_at',f), updateWorkout:(id,p)=>update('workouts',id,p), deleteWorkout:(id)=>remove('workouts',id), createMeal:(m)=>insert('meals',m), listMeals:(f)=>list('meals','eaten_at',f), updateMeal:(id,p)=>update('meals',id,p), deleteMeal:(id)=>remove('meals',id) }
```

---

## Task 3: Exercises catalog (load + search)

**Files:** Create `server/exercises.cjs`, `test/exercises.test.cjs`

**Interfaces — Produces:** `loadExercises(jsonPath)`, `searchExercises({q?,bodyPart?,equipment?,target?,limit?=50,offset?=0}) -> {total,items}`, `getExercise(id) -> record|null`, `facets() -> {bodyParts[],equipment[],targets[]}`

- [ ] **Step 1: write test/exercises.test.cjs**
```js
const { test, before } = require('node:test'); const assert = require('node:assert')
const ex = require('../server/exercises.cjs'); const path = require('node:path')
before(() => ex.loadExercises(path.join(__dirname, '..', 'data', 'exercises.json')))
test('loads full catalog', () => { assert.equal(ex.searchExercises({}).total, 1324) })
test('search by name substring', () => { const r = ex.searchExercises({ q: 'sit-up' }); assert.ok(r.total >= 1); assert.ok(r.items[0].name.toLowerCase().includes('sit-up')) })
test('filter by bodyPart + facets', () => { const f = ex.facets(); assert.ok(f.bodyParts.length > 3); const r = ex.searchExercises({ bodyPart: f.bodyParts[0], limit: 5 }); assert.ok(r.items.every((e) => e.body_part === f.bodyParts[0])) })
test('getExercise by id', () => { assert.equal(ex.getExercise('0001').name, '3/4 sit-up') })
```
- [ ] **Step 2: run — fails** — `node --test test/exercises.test.cjs` — Expected FAIL
- [ ] **Step 3: write server/exercises.cjs**
```js
const fs = require('node:fs'); let all = []
function loadExercises(jsonPath) { all = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); return all.length }
function searchExercises({ q, bodyPart, equipment, target, limit = 50, offset = 0 } = {}) {
  const ql = q ? String(q).toLowerCase() : null
  const m = all.filter((e) => (!ql || e.name.toLowerCase().includes(ql)) && (!bodyPart || e.body_part === bodyPart) && (!equipment || e.equipment === equipment) && (!target || e.target === target))
  return { total: m.length, items: m.slice(Number(offset), Number(offset) + Number(limit)) }
}
function getExercise(id) { return all.find((e) => e.id === id) || null }
function uniq(k) { return [...new Set(all.map((e) => e[k]).filter(Boolean))].sort() }
function facets() { return { bodyParts: uniq('body_part'), equipment: uniq('equipment'), targets: uniq('target') } }
module.exports = { loadExercises, searchExercises, getExercise, facets }
```
- [ ] **Step 4: run — passes** — `node --test test/exercises.test.cjs` — Expected PASS
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(consied): exercises catalog search"`

---

## Task 4: OpenFit proxy + last-good cache

**Files:** Create `server/openfit.cjs`, `test/openfit.test.cjs`

**Interfaces — Produces:** `getHealth() -> Promise<{stale:boolean, data:object|null}>` (GET OpenFit `/api/cached`, cache last good in memory; on failure return `{stale:true, data:lastGood}`), `sync() -> Promise<object>` (POST OpenFit `/api/sync`), `getStatus() -> Promise<object>` (GET OpenFit `/api/status`). Base URL from `process.env.OPENFIT_URL || 'http://127.0.0.1:42813'`.

- [ ] **Step 1: write test/openfit.test.cjs** — start a stub OpenFit http server on a random port; set `OPENFIT_URL`; assert `getHealth()` returns `{stale:false}` when up, and after stopping the stub returns `{stale:true, data:<lastGood>}`.
```js
const { test } = require('node:test'); const assert = require('node:assert'); const http = require('node:http')
test('getHealth caches last good and degrades to stale', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ source: 'google-health', date: '2026-07-01' })) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.OPENFIT_URL = 'http://127.0.0.1:' + srv.address().port
  delete require.cache[require.resolve('../server/openfit.cjs')]
  const of = require('../server/openfit.cjs')
  let h = await of.getHealth(); assert.equal(h.stale, false); assert.equal(h.data.source, 'google-health')
  await new Promise((r) => srv.close(r))
  h = await of.getHealth(); assert.equal(h.stale, true); assert.equal(h.data.date, '2026-07-01')
})
```
- [ ] **Step 2: run — fails** — `node --test test/openfit.test.cjs` — Expected FAIL
- [ ] **Step 3: write server/openfit.cjs**
```js
const BASE = () => process.env.OPENFIT_URL || 'http://127.0.0.1:42813'
let lastGood = null
async function j(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error('openfit ' + r.status); return r.json() }
async function getHealth() { try { const data = await j(BASE() + '/api/cached'); lastGood = data; return { stale: false, data } } catch { return { stale: true, data: lastGood } } }
async function sync() { const data = await j(BASE() + '/api/sync', { method: 'POST' }); lastGood = data; return data }
async function getStatus() { try { return await j(BASE() + '/api/status') } catch { return { connected: false, reachable: false } } }
module.exports = { getHealth, sync, getStatus }
```
- [ ] **Step 4: run — passes** — `node --test test/openfit.test.cjs` — Expected PASS
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(consied): openfit proxy with stale fallback"`

---

## Task 5: Day summary + calorie balance (pure logic)

**Files:** Create `server/summary.cjs`, `test/summary.test.cjs`

**Interfaces — Produces:**
- `extractHealthMetrics(cached, date) -> {steps,caloriesOut,restingHr,sleepMin,hrv,spo2,weightKg}` (pure; reads OpenFit `endpoints`).
- `nutritionTotals(meals) -> {calIn,protein,carbs,fat}` (sum, treating null as 0).
- `calorieBalance({calIn, caloriesOut}) -> {in,out,net}` (net = round(calIn - caloriesOut)).
- `daySummary(date, {cached, workouts, meals}) -> {date, health, workouts, meals, nutrition, balance}`.

OpenFit field map (from `cached.endpoints`): `caloriesOut` = `activity.summary.caloriesOut`; `steps` = `activity.summary.steps` (fallback: last of `stepsTrend['activities-steps']` matching date); `restingHr` = last `heartTrend['activities-heart']` value `.value.restingHeartRate` for date; `sleepMin` = matching `sleepTrend.sleep[].minutesAsleep`; `hrv` last `hrv.hrv[]`; `spo2` from `spo2`; `weightKg` last `bodyWeight.weight[]`. All guarded with optional chaining; missing -> null.

- [ ] **Step 1: write test/summary.test.cjs**
```js
const { test } = require('node:test'); const assert = require('node:assert')
const s = require('../server/summary.cjs')
test('nutritionTotals sums nullable macros', () => {
  const t = s.nutritionTotals([{ calories: 300, protein_g: 10 }, { calories: 200, protein_g: null, carbs_g: 5 }])
  assert.equal(t.calIn, 500); assert.equal(t.protein, 10); assert.equal(t.carbs, 5)
})
test('calorieBalance net = in - out (rounded)', () => {
  assert.deepEqual(s.calorieBalance({ calIn: 2100, caloriesOut: 2450.7 }), { in: 2100, out: 2451, net: -351 })
})
test('extractHealthMetrics reads activity.summary', () => {
  const cached = { endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2200 } } } }
  const h = s.extractHealthMetrics(cached, '2026-07-01')
  assert.equal(h.steps, 8000); assert.equal(h.caloriesOut, 2200)
})
```
- [ ] **Step 2: run — fails** — `node --test test/summary.test.cjs` — Expected FAIL
- [ ] **Step 3: write server/summary.cjs**
```js
const num = (v) => (v == null ? 0 : Number(v) || 0)
function nutritionTotals(meals) { return meals.reduce((a, m) => ({ calIn: a.calIn + num(m.calories), protein: a.protein + num(m.protein_g), carbs: a.carbs + num(m.carbs_g), fat: a.fat + num(m.fat_g) }), { calIn: 0, protein: 0, carbs: 0, fat: 0 }) }
function calorieBalance({ calIn, caloriesOut }) { const i = Math.round(num(calIn)), o = Math.round(num(caloriesOut)); return { in: i, out: o, net: i - o } }
function extractHealthMetrics(cached, date) {
  const ep = (cached && cached.endpoints) || {}
  const summ = (ep.activity && ep.activity.summary) || {}
  const lastVal = (arr, pick) => { if (!Array.isArray(arr) || !arr.length) return null; const row = arr[arr.length - 1]; return pick(row) }
  return {
    steps: summ.steps != null ? Number(summ.steps) : null,
    caloriesOut: summ.caloriesOut != null ? Math.round(Number(summ.caloriesOut)) : null,
    restingHr: lastVal(ep.heartTrend && ep.heartTrend['activities-heart'], (r) => r && r.value && r.value.restingHeartRate) || null,
    sleepMin: lastVal(ep.sleepTrend && ep.sleepTrend.sleep, (r) => r && r.minutesAsleep) || null,
    hrv: lastVal(ep.hrv && ep.hrv.hrv, (r) => r && (r.dailyRmssd || r.value)) || null,
    spo2: null,
    weightKg: lastVal(ep.bodyWeight && ep.bodyWeight.weight, (r) => r && (r.weight)) || null,
  }
}
function daySummary(date, { cached, workouts, meals }) {
  const health = extractHealthMetrics(cached, date)
  const nutrition = nutritionTotals(meals)
  const balance = calorieBalance({ calIn: nutrition.calIn, caloriesOut: health.caloriesOut })
  return { date, health, workouts, meals, nutrition, balance }
}
module.exports = { extractHealthMetrics, nutritionTotals, calorieBalance, daySummary }
```
- [ ] **Step 4: run — passes** — `node --test test/summary.test.cjs` — Expected PASS
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(consied): day summary + calorie balance"`

---

## Task 6: HTTP server wiring + static serving + smoke test

**Files:** Create `server/index.cjs`, `test/smoke.test.cjs`

**Interfaces — Consumes:** all modules above. **Produces:** `createServer({port,dbFile,exercisesJson,distDir}) -> http.Server`.

Routes (all under one origin, JSON except static):
- `GET  /api/status` -> `{app:'consied', openfit: await getStatus()}`
- `GET  /api/health` -> `await getHealth()`
- `POST /api/sync` -> `await sync()`
- `GET  /api/exercises` -> `searchExercises(query)`  ·  `GET /api/exercises/facets` -> `facets()`  ·  `GET /api/exercises/:id` -> `getExercise` (404 if null)
- `GET/POST /api/workouts`, `PATCH/DELETE /api/workouts/:id`
- `GET/POST /api/meals`, `PATCH/DELETE /api/meals/:id`
- `GET  /api/summary?date=YYYY-MM-DD` -> compose from getHealth + listWorkouts/listMeals bounded to [date, date+1)
- Fallback: serve `distDir` static; unknown non-`/api` path -> `index.html` (SPA fallback).

- [ ] **Step 1: write test/smoke.test.cjs** — boot `createServer` with `:memory:` db and the real exercises.json, `OPENFIT_URL` pointed at a stub; assert: `/api/exercises?q=sit-up` returns items; POST `/api/workouts` then GET returns it; POST `/api/meals` then `/api/summary?date=...` returns `balance.net` number.
```js
const { test } = require('node:test'); const assert = require('node:assert'); const http = require('node:http'); const path = require('node:path')
test('server smoke: exercises, workout, meal, summary', async () => {
  const stub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2400 } } } })) })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r)); process.env.OPENFIT_URL = 'http://127.0.0.1:' + stub.address().port
  const { createServer } = require('../server/index.cjs')
  const srv = createServer({ port: 0, dbFile: ':memory:', exercisesJson: path.join(__dirname, '..', 'data', 'exercises.json'), distDir: path.join(__dirname, '..', 'dist') })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port
  const g = async (u, o) => (await fetch(base + u, o)).json()
  assert.ok((await g('/api/exercises?q=sit-up')).total >= 1)
  const w = await g('/api/workouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Squat', performed_at: '2026-07-01T10:00:00' }) })
  assert.ok(w.id)
  await g('/api/meals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300 }) })
  const sum = await g('/api/summary?date=2026-07-01')
  assert.equal(typeof sum.balance.net, 'number'); assert.equal(sum.balance.out, 2400)
  await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r))
})
```
- [ ] **Step 2: run — fails** — `node --test test/smoke.test.cjs` — Expected FAIL
- [ ] **Step 3: write server/index.cjs** — implement `createServer` with manual routing (match method+pathname, `/api/*` first, else static from distDir with SPA fallback to index.html). Wire: `db.initDb(dbFile)`, `exercises.loadExercises(exercisesJson)`. Use http-helpers. Summary route computes `from=date`, `to=date+1day` (string compare works on ISO). At bottom: `if (require.main === module) createServer({port:42815, dbFile:process.env.CONSIED_DB||'/home/saiteja/consied/.data/consied.sqlite', exercisesJson:__dirname+'/../data/exercises.json', distDir:__dirname+'/../dist'}).listen(42815,'127.0.0.1',()=>console.log('consied on 42815'))`.
- [ ] **Step 4: run — passes** — `node --test` (all tests) — Expected PASS
- [ ] **Step 5: manual boot check** — `node server/index.cjs &` then `curl -s http://127.0.0.1:42815/api/status` returns JSON; kill by port.
- [ ] **Step 6: commit** — `git add -A && git commit -m "feat(consied): http server wiring + smoke test"`

---

## Task 7: Frontend scaffold (Vite + React + TS) + typed API client

**Files:** Create `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`, `src/types.ts`, `src/api.ts`

**Interfaces — Produces:** `api.ts` with typed fns: `getSummary(date)`, `getHealth()`, `postSync()`, `searchExercises(params)`, `getFacets()`, `getExercise(id)`, `listWorkouts(range)`, `createWorkout(w)`, `updateWorkout(id,p)`, `deleteWorkout(id)`, `listMeals(range)`, `createMeal(m)`, `updateMeal(id,p)`, `deleteMeal(id)`. `types.ts`: `Exercise, Workout, Meal, DaySummary, HealthMetrics, Facets`.

- [ ] **Step 1:** `npm i react react-dom react-router-dom recharts && npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom`
- [ ] **Step 2:** vite.config.ts — React plugin; `server.port=5175`; `server.proxy['/api'] = 'http://127.0.0.1:42815'` (dev proxies to backend); `build.outDir='dist'`.
- [ ] **Step 3:** tsconfig.json — standard Vite React TS (target ES2022, jsx react-jsx, strict true, moduleResolution bundler).
- [ ] **Step 4:** index.html with `<div id="root">` + `<script type="module" src="/src/main.tsx">`.
- [ ] **Step 5:** src/types.ts — declare the types matching backend shapes (Exercise per catalog fields; Workout/Meal per DB columns; DaySummary per Task 5).
- [ ] **Step 6:** src/api.ts — thin `fetch` wrapper (`const j=(u,o)=>fetch(u,o).then(r=>r.json())`) implementing the fns above against `/api/*`.
- [ ] **Step 7:** src/main.tsx + src/App.tsx — React Router with 5 routes + a bottom/side nav (placeholder markup; styled in Task 8). Routes: `/` Today, `/exercises`, `/workouts`, `/meals`, `/trends`.
- [ ] **Step 8:** `npm run build` succeeds -> `dist/` created.
- [ ] **Step 9: commit** — `git add -A && git commit -m "feat(consied): frontend scaffold + api client"`

---

## Task 8: Uber / Base Web design system (`/design-system` skill)

**Files:** Create `src/theme/tokens.css` (or ts), `src/components/{Button,Card,Tabs,Input,Stat,Table,AppShell}.tsx`

- [ ] **Step 1:** Invoke the `/design-system` skill with brand = **Uber (Base Web)**; generate design tokens (color: near-black `#000`/`#141414` primary on white, one accent, greys; type: system/Uber-Move-like; spacing scale; small radii) and the shared component set listed above. Output goes to `src/theme` + `src/components`.
- [ ] **Step 2:** Apply `AppShell` (top bar + responsive nav) in `App.tsx`; wire nav links.
- [ ] **Step 3:** Verify build + a screenshot via `/browse` of `http://127.0.0.1:5175` (dev) shows the Uber look on desktop + mobile widths.
- [ ] **Step 4: commit** — `git add -A && git commit -m "feat(consied): Uber/Base-Web design system"`

---

## Task 9: Today screen

**Files:** Create/replace `src/screens/Today.tsx`

**Behavior:** on mount `getSummary(today)`; render Stat cards (steps, caloriesOut, restingHr, sleepMin, hrv, weightKg) from `health`; a **calorie balance** card (`balance.in` meals vs `balance.out` health, `net` colored); lists of today's workouts + meals (compact); a **Sync** button calling `postSync()` then refetch, with loading state; if `health` came back `stale`, show a banner.

- [ ] **Step 1:** implement component using shared `Stat`/`Card` components + `api.getSummary`/`api.postSync`.
- [ ] **Step 2:** acceptance — `/browse` dev URL: cards show real numbers; Sync button triggers a refetch; stale banner appears when OpenFit is stopped.
- [ ] **Step 3: commit** — `git add -A && git commit -m "feat(consied): Today screen"`

---

## Task 10: Exercises screen

**Files:** Create `src/screens/Exercises.tsx`

**Behavior:** load `getFacets()`; search box (debounced) + bodyPart/equipment/target dropdowns -> `searchExercises`; grid/list of results (name, target, equipment, GIF thumbnail from `gif_url` with `onError` -> placeholder); detail panel/modal shows `instruction_steps` + big GIF + a **"Log this workout"** button that opens the workout form prefilled with `exercise_id` + `name` (calls `createWorkout`). Paginate via limit/offset.

- [ ] **Step 1:** implement search + filters + results grid with image fallback.
- [ ] **Step 2:** implement detail + "Log this workout" -> createWorkout, toast on success.
- [ ] **Step 3:** acceptance — search "press" returns results; a broken GIF shows placeholder; logging creates a workout (verify on Workouts screen).
- [ ] **Step 4: commit** — `git add -A && git commit -m "feat(consied): Exercises library + log-from-exercise"`

---

## Task 11: Workouts screen

**Files:** Create `src/screens/Workouts.tsx`

**Behavior:** `listWorkouts` (default last 30 days) in a table (date, name, sets×reps@weight, duration, notes); add button opens a form (name, performed_at default now, sets/reps/weight/duration/notes); edit + delete rows via `updateWorkout`/`deleteWorkout`. Optimistic refetch after mutations.

- [ ] **Step 1:** table + add form + edit/delete.
- [ ] **Step 2:** acceptance — add/edit/delete round-trip visible; persists across reload (SQLite).
- [ ] **Step 3: commit** — `git add -A && git commit -m "feat(consied): Workouts log"`

---

## Task 12: Meals screen

**Files:** Create `src/screens/Meals.tsx`

**Behavior:** day picker (default today); list meals for the day with per-meal kcal/macros + a **daily totals** bar (calIn, protein, carbs, fat from `nutritionTotals` client-side or `/api/summary`); add form (name, meal_type select, eaten_at default now, calories, protein_g, carbs_g, fat_g, notes); edit/delete via `updateMeal`/`deleteMeal`.

- [ ] **Step 1:** list + totals + add form + edit/delete.
- [ ] **Step 2:** acceptance — adding a meal updates totals and the Today balance card.
- [ ] **Step 3: commit** — `git add -A && git commit -m "feat(consied): Meals log + daily totals"`

---

## Task 13: Trends screen

**Files:** Create `src/screens/Trends.tsx`

**Behavior:** pull `getHealth()` trend endpoints (`stepsTrend`, `caloriesTrend`, `heartTrend`, `sleepTrend`, `bodyWeight`, `metricTrends`) + logged meals/workouts over a range; render `recharts` line/area charts: steps/day, calories out vs in/day, resting HR, sleep minutes, weight. Range selector (7/30/90 days). Handle empty series gracefully.

- [ ] **Step 1:** map OpenFit trend arrays to chart series (dateTime/value); overlay meal calIn per day for the in-vs-out chart.
- [ ] **Step 2:** acceptance — charts render with real trend data; empty metrics show an empty-state, not a crash.
- [ ] **Step 3: commit** — `git add -A && git commit -m "feat(consied): Trends charts"`

---

## Task 14: Production build + systemd service

**Files:** Create `deploy/consied.service`

- [ ] **Step 1:** `npm run build` -> `dist/`. Confirm `node server/index.cjs` serves the SPA at `/` and API at `/api/*` on 42815.
- [ ] **Step 2:** write `deploy/consied.service`:
```ini
[Unit]
Description=Consied health tracker
After=network-online.target openfit.service
Wants=network-online.target

[Service]
Type=simple
User=saiteja
Group=saiteja
WorkingDirectory=/home/saiteja/consied
Environment=CONSIED_DB=/home/saiteja/consied/.data/consied.sqlite
ExecStart=/home/saiteja/.nvm/versions/node/v25.1.0/bin/node /home/saiteja/consied/server/index.cjs
Restart=always
RestartSec=3
StandardOutput=append:/home/saiteja/consied/.data/consied.log
StandardError=append:/home/saiteja/consied/.data/consied.log

[Install]
WantedBy=multi-user.target
```
- [ ] **Step 3:** `sudo cp deploy/consied.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now consied`
- [ ] **Step 4:** verify — `systemctl is-active consied` = active; `curl -s http://127.0.0.1:42815/api/status` returns JSON; `is-enabled` = enabled.
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(consied): systemd service"`

---

## Task 15: Cloudflare tunnel + Access

**Files:** Modify `~/.cloudflared/config.yml`

- [ ] **Step 1:** back up config; add ingress rule ABOVE the `http_status:404` catch-all:
```yaml
  - hostname: health.saitejamothukuri.com
    service: http://localhost:42815
```
- [ ] **Step 2:** DNS route: `cloudflared tunnel route dns 7606260f-ec22-4a25-8dca-6a9a12f8288d health.saitejamothukuri.com` (creates the CNAME).
- [ ] **Step 3:** ensure cloudflared runs as a service (it is currently **inactive**): confirm/create the systemd unit and `sudo systemctl enable --now cloudflared` (or the existing tunnel service name); `systemctl is-active` = active.
- [ ] **Step 4:** In Cloudflare Zero Trust dashboard → Access → Applications: add `health.saitejamothukuri.com`, policy = allow email `saiteja.motukuri@gmail.com` (email OTP). (Manual dashboard step — document it; the user performs it.)
- [ ] **Step 5:** verify — from an external device, `https://health.saitejamothukuri.com` prompts Cloudflare Access login, then loads Consied. Health data + logging work end to end.
- [ ] **Step 6: commit** — `git add -A && git commit -m "feat(consied): cloudflare tunnel + access"`

---

## Self-Review notes
- Spec coverage: every spec section maps to a task (health proxy→T4, exercises→T3/T10, workouts→T2/T11, meals→T2/T12, summary/balance→T5, Uber UI→T8, deploy→T14, tunnel/Access→T15). ✓
- Types consistent across tasks (Workout/Meal columns, DaySummary shape, api.ts fns). ✓
- Known manual step: Cloudflare Access policy (T15 S4) is dashboard-side — flagged, not automatable here.
- Risk: `spo2` extraction left null (OpenFit spo2 shape unreliable); revisit if needed.
