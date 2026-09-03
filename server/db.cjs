// Uses node:sqlite (DatabaseSync), not better-sqlite3: Node 25's native build tooling
// doesn't have a prebuilt better-sqlite3 binary yet, and node:sqlite covers the same
// sync API this module needs (prepare/run/get/all, WAL pragma).
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

let db = null
let dataDir = null // sibling "photos" dir lives next to the sqlite file; null for :memory:

function initDb(file) {
  dataDir = file === ':memory:' ? null : path.dirname(file)
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id TEXT,
      name TEXT NOT NULL,
      performed_at TEXT NOT NULL,
      sets INTEGER, reps INTEGER, weight_kg REAL, duration_min REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      meal_type TEXT,
      eaten_at TEXT NOT NULL,
      calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meal_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      calorie_goal REAL, protein_goal REAL, steps_goal INTEGER,
      sleep_goal_min INTEGER, weight_goal_kg REAL, height_cm REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, habit TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date, habit)
    );
    CREATE TABLE IF NOT EXISTS habit_defs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS body_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      weight_kg REAL, body_fat_pct REAL, waist_cm REAL, chest_cm REAL, arm_cm REAL,
      notes TEXT, photo_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workout_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, kind TEXT, items_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'slack', enabled INTEGER NOT NULL DEFAULT 1,
      time_of_day TEXT NOT NULL DEFAULT '20:00', target TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reminder_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reminder_id, date)
    );
    CREATE TABLE IF NOT EXISTS hydration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL, ml REAL NOT NULL, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gh_nutrition_daily (
      date TEXT PRIMARY KEY,
      calories REAL, protein REAL, carbs REAL, fat REAL, fiber REAL, sugar REAL, sodium REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gh_food_items (
      item_key TEXT PRIMARY KEY,
      date TEXT NOT NULL, eaten_at TEXT, food_name TEXT, meal_type TEXT,
      calories REAL, protein REAL, carbs REAL, fat REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gh_daily (
      date TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, endpoint)
    );
    CREATE TABLE IF NOT EXISTS gh_exercise_sessions (
      session_id TEXT PRIMARY KEY,
      date TEXT NOT NULL, start_time TEXT, end_time TEXT, exercise_type TEXT, name TEXT,
      active_duration_s REAL, elapsed_s REAL, calories_kcal REAL, distance_m REAL, steps INTEGER,
      avg_hr_bpm REAL, active_zone_minutes REAL,
      hr_light_min REAL, hr_moderate_min REAL, hr_vigorous_min REAL, hr_peak_min REAL,
      pauses INTEGER, has_gps INTEGER, notes TEXT, source_platform TEXT,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_performed ON workouts(performed_at);
    CREATE INDEX IF NOT EXISTS idx_gh_exercise_date ON gh_exercise_sessions(date);
    CREATE INDEX IF NOT EXISTS idx_hydration_at ON hydration(at);
    CREATE INDEX IF NOT EXISTS idx_gh_food_date ON gh_food_items(date);
    CREATE INDEX IF NOT EXISTS idx_meals_eaten ON meals(eaten_at);
    CREATE INDEX IF NOT EXISTS idx_habits_date ON habits(date);
    CREATE INDEX IF NOT EXISTS idx_body_metrics_date ON body_metrics(date);
  `)
  // The sqlite file is live and pre-existing: columns added after v1 are ALTERed in, never recreated.
  ensureColumns('workouts', { plan_id: 'INTEGER', session_id: 'TEXT' })
  ensureColumns('gh_food_items', {
    serving_amount: 'REAL', serving_unit: 'TEXT', energy_from_fat: 'REAL', fiber: 'REAL', sugar: 'REAL',
    sodium: 'REAL', saturated_fat: 'REAL', cholesterol: 'REAL', food_ref: 'TEXT', nutrients_json: 'TEXT',
  })
  ensureColumns('gh_nutrition_daily', { saturated_fat: 'REAL', cholesterol: 'REAL', nutrients_json: 'TEXT' })
  db.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)")
  seedMealRecipes()
  seedWorkoutPlans()
  seedHabitDefs()
  return db
}

function shiftISO(date, delta) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Idempotent ADD COLUMN: sqlite has no IF NOT EXISTS for columns, so check table_info first.
function ensureColumns(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name))
  for (const [col, decl] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
}

const COLS = {
  workouts: ['exercise_id', 'name', 'performed_at', 'sets', 'reps', 'weight_kg', 'duration_min', 'notes', 'plan_id', 'session_id'],
  meals: ['name', 'meal_type', 'eaten_at', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'notes'],
  meal_recipes: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'notes'],
  reminders: ['kind', 'channel', 'enabled', 'time_of_day', 'target'],
  hydration: ['at', 'ml', 'notes'],
}
const BUMP_UPDATED_AT = new Set(['meal_recipes', 'reminders'])

const SEED_RECIPES = [
  {
    name: 'Chicken pulao',
    calories: 680,
    protein_g: 50,
    carbs_g: 64,
    fat_g: 24,
    notes: 'Meal-prep recipe from 2026-07-02: ground chicken 2.727kg, onions 580g, tomatoes 450g, butter 14g, basmati rice 725g; batch divided into 10 boxes for 5 days lunch+dinner. Macros are per box, with protein reduced by 4g per request.',
  },
]

function seedMealRecipes() {
  const stmt = db.prepare(`
    INSERT INTO meal_recipes (name, calories, protein_g, carbs_g, fat_g, notes)
    VALUES (@name, @calories, @protein_g, @carbs_g, @fat_g, @notes)
    ON CONFLICT(name) DO NOTHING
  `)
  for (const recipe of SEED_RECIPES) stmt.run(recipe)
}

const SEED_PLANS = [
  { name: 'Push Day', kind: 'push', items: [
    { name: 'Bench press', target_sets: 4, target_reps: 8, target_weight_kg: null },
    { name: 'Overhead press', target_sets: 3, target_reps: 10, target_weight_kg: null },
    { name: 'Incline dumbbell press', target_sets: 3, target_reps: 10, target_weight_kg: null },
    { name: 'Triceps pushdown', target_sets: 3, target_reps: 12, target_weight_kg: null },
  ] },
  { name: 'Pull Day', kind: 'pull', items: [
    { name: 'Deadlift', target_sets: 3, target_reps: 5, target_weight_kg: null },
    { name: 'Pull-up', target_sets: 4, target_reps: 8, target_weight_kg: null },
    { name: 'Barbell row', target_sets: 3, target_reps: 10, target_weight_kg: null },
    { name: 'Biceps curl', target_sets: 3, target_reps: 12, target_weight_kg: null },
  ] },
  { name: 'Leg Day', kind: 'legs', items: [
    { name: 'Squat', target_sets: 4, target_reps: 8, target_weight_kg: null },
    { name: 'Romanian deadlift', target_sets: 3, target_reps: 10, target_weight_kg: null },
    { name: 'Leg press', target_sets: 3, target_reps: 12, target_weight_kg: null },
    { name: 'Calf raise', target_sets: 4, target_reps: 15, target_weight_kg: null },
  ] },
]

function seedWorkoutPlans() {
  const stmt = db.prepare(`
    INSERT INTO workout_plans (name, kind, items_json) VALUES (@name, @kind, @items_json)
    ON CONFLICT(name) DO NOTHING
  `)
  for (const p of SEED_PLANS) stmt.run({ name: p.name, kind: p.kind, items_json: JSON.stringify(p.items) })
}

function insert(table, obj) {
  const c = COLS[table].filter((k) => obj[k] !== undefined)
  const info = db
    .prepare(`INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map((k) => '@' + k).join(', ')})`)
    .run(Object.fromEntries(c.map((k) => [k, obj[k]])))
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(info.lastInsertRowid))
}

function list(table, field, opts) {
  const { from, to } = opts || {}
  let sql = `SELECT * FROM ${table}`
  const params = []
  if (from) { sql += ` WHERE ${field} >= ?`; params.push(from) }
  if (to) { sql += (from ? ' AND ' : ' WHERE ') + `${field} < ?`; params.push(to) }
  sql += ` ORDER BY ${field} DESC`
  return db.prepare(sql).all(...params)
}

function update(table, id, patch) {
  const c = COLS[table].filter((k) => patch[k] !== undefined)
  if (c.length) {
    const sets = c.map((k) => `${k} = @${k}`)
    if (BUMP_UPDATED_AT.has(table)) sets.push(`updated_at = datetime('now')`)
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`)
      .run({ ...Object.fromEntries(c.map((k) => [k, patch[k]])), id })
  }
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
}

function remove(table, id) {
  return { deleted: db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0 }
}

// session_id links a set to a Google Health exercise session (which records no sets/reps itself).
function listWorkouts(opts) {
  const { session_id, ...range } = opts || {}
  const rows = list('workouts', 'performed_at', range)
  return session_id ? rows.filter((r) => r.session_id === session_id) : rows
}

function listMeals(opts) {
  const { meal_type, limit, ...range } = opts || {}
  let rows = list('meals', 'eaten_at', range)
  if (meal_type) rows = rows.filter((r) => r.meal_type === meal_type)
  if (limit) rows = rows.slice(0, Number(limit))
  return rows
}

// ===== Google Health nutrition cache (daily macro totals + individual food items) =====
// Upsert-by-key over a fixed column list; every column is rewritten so a re-sync can null out a
// value Google dropped instead of leaving the stale one behind.
const upsertStmt = (table, key, cols) => db.prepare(`
  INSERT INTO ${table} (${key}, ${cols.join(', ')}, updated_at)
  VALUES (@${key}, ${cols.map((c) => '@' + c).join(', ')}, datetime('now'))
  ON CONFLICT(${key}) DO UPDATE SET ${cols.map((c) => `${c}=@${c}`).join(', ')}, updated_at=datetime('now')`)
const DAILY_NUM = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'saturated_fat', 'cholesterol']
const ITEM_NUM = ['calories', 'protein', 'carbs', 'fat', 'serving_amount', 'energy_from_fat', 'fiber', 'sugar', 'sodium', 'saturated_fat', 'cholesterol']
const upsertNutritionDailyStmt = () => upsertStmt('gh_nutrition_daily', 'date', [...DAILY_NUM, 'nutrients_json'])
const upsertFoodItemStmt = () => upsertStmt('gh_food_items', 'item_key', ['date', 'eaten_at', 'food_name', 'meal_type', 'serving_unit', 'food_ref', ...ITEM_NUM, 'nutrients_json'])
const nn = (v) => (v == null ? null : Number(v))
const nums = (obj, keys) => Object.fromEntries(keys.map((k) => [k, nn(obj[k])]))
// nutrients: {NUTRIENT: grams} — stored as JSON because Google lists 40 possible nutrients and a column each is not worth it.
const nutrientsJson = (n) => (n && Object.keys(n).length ? JSON.stringify(n) : null)
function parseNutrients(row) {
  if (!row) return row
  const { nutrients_json, ...rest } = row
  let nutrients = {}
  try { nutrients = JSON.parse(nutrients_json || '{}') } catch { /* corrupt cell: empty beats throwing on a read */ }
  return { ...rest, nutrients }
}

// Bulk-cache a fetchNutrition() result. Returns counts written.
function cacheNutrition({ daily = [], items = [] } = {}) {
  const dStmt = upsertNutritionDailyStmt()
  const iStmt = upsertFoodItemStmt()
  db.exec('BEGIN')
  try {
    for (const d of daily) dStmt.run({ date: d.date, ...nums(d, DAILY_NUM), nutrients_json: nutrientsJson(d.nutrients) })
    for (const it of items) iStmt.run({
      item_key: it.item_key, date: it.date, eaten_at: it.eaten_at || null, food_name: it.food_name || null, meal_type: it.meal_type || null,
      serving_unit: it.serving_unit || null, food_ref: it.food_ref || null, ...nums(it, ITEM_NUM), nutrients_json: nutrientsJson(it.nutrients),
    })
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return { daysWritten: daily.length, itemsWritten: items.length }
}
const getNutritionDaily = (date) => parseNutrients(db.prepare('SELECT * FROM gh_nutrition_daily WHERE date = ?').get(date)) || null
const listNutritionDaily = (range) => list('gh_nutrition_daily', 'date', range || {}).map(parseNutrients)
const listFoodItems = (range) => list('gh_food_items', 'date', range || {}).map(parseNutrients).sort((a, b) => (a.eaten_at || '').localeCompare(b.eaten_at || ''))
const nutritionCacheStats = () => db.prepare('SELECT COUNT(*) days, MIN(date) first, MAX(date) last FROM gh_nutrition_daily').get()

// ===== Google Health exercise session cache =====
// Indexed columns are the ones worth filtering/summing on; `json` holds the full Session (incl. raw)
// so a reader never needs a second API call. Sets/reps are NOT here — Google has none; they live in
// `workouts` and link back via workouts.session_id.
const SESSION_COLS = ['date', 'start_time', 'end_time', 'exercise_type', 'name', 'active_duration_s', 'elapsed_s', 'calories_kcal',
  'distance_m', 'steps', 'avg_hr_bpm', 'active_zone_minutes', 'hr_light_min', 'hr_moderate_min', 'hr_vigorous_min', 'hr_peak_min',
  'pauses', 'has_gps', 'notes', 'source_platform', 'json']
function cacheExerciseSessions(sessions = []) {
  const stmt = upsertStmt('gh_exercise_sessions', 'session_id', SESSION_COLS)
  db.exec('BEGIN')
  try {
    for (const s of sessions) {
      const z = s.hr_zones_min || {}
      stmt.run({
        session_id: s.session_id, date: s.date, start_time: s.start_time || null, end_time: s.end_time || null,
        exercise_type: s.exercise_type || null, name: s.name || null,
        ...nums(s, ['active_duration_s', 'elapsed_s', 'calories_kcal', 'distance_m', 'steps', 'avg_hr_bpm', 'active_zone_minutes', 'pauses']),
        hr_light_min: nn(z.light), hr_moderate_min: nn(z.moderate), hr_vigorous_min: nn(z.vigorous), hr_peak_min: nn(z.peak),
        has_gps: s.has_gps == null ? null : s.has_gps ? 1 : 0, notes: s.notes || null, source_platform: s.source?.platform || null,
        json: JSON.stringify(s),
      })
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return { upserted: sessions.length }
}
// Parsed json wins over the columns: it's the same Session the columns were derived from, plus raw/events/laps.
function parseSession(row) {
  if (!row) return null
  const { json, ...cols } = row
  try { return { ...cols, ...JSON.parse(json) } } catch { return cols }
}
const listExerciseSessions = (range) => list('gh_exercise_sessions', 'date', range || {}).map(parseSession)
  .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
const getExerciseSession = (sessionId) => parseSession(db.prepare('SELECT * FROM gh_exercise_sessions WHERE session_id = ?').get(sessionId))
const exerciseCacheStats = () => db.prepare('SELECT COUNT(*) sessions, MIN(date) first, MAX(date) last FROM gh_exercise_sessions').get()

// ===== Google Health daily cache =====
// One row per (date, endpoint) holding that endpoint's raw JSON. Deliberately schema-less:
// Google adds and renames endpoints, and a generic store means a new one is cached the day it
// appears instead of silently dropped until someone writes a migration.
const upsertDailyStmt = () => db.prepare(`
  INSERT INTO gh_daily (date, endpoint, json, updated_at)
  VALUES (@date, @endpoint, @json, datetime('now'))
  ON CONFLICT(date, endpoint) DO UPDATE SET json=@json, updated_at=datetime('now')`)

// Cache one day's endpoint map. Returns { date, endpointsWritten, bytes }.
function cacheDailyHealth(date, endpoints = {}) {
  const stmt = upsertDailyStmt()
  let bytes = 0
  db.exec('BEGIN')
  try {
    for (const [endpoint, value] of Object.entries(endpoints)) {
      if (value == null) continue
      const json = JSON.stringify(value)
      bytes += json.length
      stmt.run({ date, endpoint, json })
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return { date, endpointsWritten: Object.keys(endpoints).length, bytes }
}

// Rebuild a cached day into the same shape a live pull returns, so callers can't tell them apart.
function getDailyHealth(date) {
  const rows = db.prepare('SELECT endpoint, json, updated_at FROM gh_daily WHERE date = ?').all(date)
  if (!rows.length) return null
  const endpoints = {}
  for (const r of rows) {
    try { endpoints[r.endpoint] = JSON.parse(r.json) } catch { /* skip a corrupt row rather than lose the day */ }
  }
  return { source: 'google-health', date, cached: true, cachedAt: rows[0].updated_at, endpoints }
}

function getDailyEndpoint(date, endpoint) {
  const row = db.prepare('SELECT json FROM gh_daily WHERE date = ? AND endpoint = ?').get(date, endpoint)
  if (!row) return null
  try { return JSON.parse(row.json) } catch { return null }
}

const listCachedHealthDates = (range) =>
  db.prepare(`SELECT DISTINCT date FROM gh_daily${range?.from ? ' WHERE date >= @from AND date < @to' : ''} ORDER BY date`)
    .all(range?.from ? { from: range.from, to: range.to } : {}).map((r) => r.date)

const healthCacheStats = () => db.prepare(
  'SELECT COUNT(DISTINCT date) days, MIN(date) first, MAX(date) last, COUNT(*) rows, SUM(LENGTH(json)) bytes FROM gh_daily').get()

function duplicateMeals(fromDate, toDate) {
  const rows = db.prepare('SELECT * FROM meals WHERE substr(eaten_at, 1, 10) = ?').all(fromDate)
  return rows.map((r) => insert('meals', {
    name: r.name, meal_type: r.meal_type, eaten_at: toDate + r.eaten_at.slice(10),
    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, notes: r.notes,
  }))
}

// --- settings (singleton row) ---
function getSettings() { return db.prepare('SELECT * FROM settings WHERE id = 1').get() }
const SETTINGS_COLS = ['calorie_goal', 'protein_goal', 'steps_goal', 'sleep_goal_min', 'weight_goal_kg', 'height_cm']
function updateSettings(patch) {
  const c = SETTINGS_COLS.filter((k) => patch[k] !== undefined)
  if (c.length) {
    db.prepare(`UPDATE settings SET ${c.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = 1`)
      .run(Object.fromEntries(c.map((k) => [k, patch[k]])))
  }
  return getSettings()
}

// --- habits (custom definitions + per-date checklist + streaks) ---
const DEFAULT_HABITS = ['No sugar', 'No beverage', 'No junk', 'Water', 'Creatine', 'Vitamins', 'Meditation', 'Walk']

// Every habit that already has check-data gets a definition — preserves pre-feature rows and
// anything restored via import so it stays visible in the list.
function ensureHabitDefsForData() {
  const names = db.prepare('SELECT DISTINCT habit FROM habits').all().map((r) => r.habit)
  const ins = db.prepare("INSERT INTO habit_defs (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM habit_defs)) ON CONFLICT(name) DO NOTHING")
  for (const n of names) ins.run(n)
}
function seedHabitDefs() {
  ensureHabitDefsForData()
  if (db.prepare('SELECT COUNT(*) AS n FROM habit_defs').get().n === 0) {
    const ins = db.prepare('INSERT INTO habit_defs (name, sort) VALUES (@name, @sort)')
    DEFAULT_HABITS.forEach((name, i) => ins.run({ name, sort: i }))
  }
}

function getHabits(date) {
  const rows = db.prepare('SELECT habit, done FROM habits WHERE date = ?').all(date)
  return Object.fromEntries(rows.map((r) => [r.habit, Boolean(r.done)]))
}
function setHabit(date, habit, done) {
  createHabit(habit)
  db.prepare(`
    INSERT INTO habits (date, habit, done) VALUES (@date, @habit, @done)
    ON CONFLICT(date, habit) DO UPDATE SET done = @done
  `).run({ date, habit, done: done ? 1 : 0 })
  return getHabits(date)
}

// Consecutive done-days ending at endDate. The day itself must be logged to count: a streak
// only advances when you explicitly log that day — no automatic grace for an unlogged "today".
function habitStreak(habit, endDate) {
  const done = new Set(db.prepare('SELECT date FROM habits WHERE habit = ? AND done = 1').all(habit).map((r) => r.date))
  let d = endDate
  let streak = 0
  while (done.has(d)) { streak++; d = shiftISO(d, -1) }
  return streak
}
function habitHistory(habit, endDate, days = 60) {
  const safeDays = Math.max(1, Math.min(60, Number(days) || 60))
  const from = shiftISO(endDate, -(safeDays - 1))
  const done = new Set(db.prepare('SELECT date FROM habits WHERE habit = ? AND done = 1 AND date >= ? AND date <= ?').all(habit, from, endDate).map((r) => r.date))
  const out = []
  for (let i = safeDays - 1; i >= 0; i--) {
    const date = shiftISO(endDate, -i)
    out.push({ date, done: done.has(date) })
  }
  return out
}
function listHabits(date) {
  const done = getHabits(date)
  return db.prepare('SELECT name FROM habit_defs ORDER BY sort ASC, id ASC').all()
    .map(({ name }) => {
      const streak = habitStreak(name, date)
      return { name, done: Boolean(done[name]), streak, history: habitHistory(name, date, streak > 30 ? 60 : 30) }
    })
}
function createHabit(name) {
  const n = String(name || '').trim()
  if (!n) throw new Error('habit name required')
  db.prepare("INSERT INTO habit_defs (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM habit_defs)) ON CONFLICT(name) DO NOTHING").run(n)
  return { name: n }
}
function deleteHabit(name) {
  db.prepare('DELETE FROM habit_defs WHERE name = ?').run(name)
  db.prepare('DELETE FROM habits WHERE habit = ?').run(name)
  return { deleted: true }
}

// --- body metrics (manual log, upsert by date) + private local photo storage ---
const BODY_COLS = ['weight_kg', 'body_fat_pct', 'waist_cm', 'chest_cm', 'arm_cm', 'notes', 'photo_ref']
function getBodyMetric(date) { return db.prepare('SELECT * FROM body_metrics WHERE date = ?').get(date) }
function upsertBodyMetric(date, patch) {
  const c = BODY_COLS.filter((k) => patch[k] !== undefined)
  if (getBodyMetric(date)) {
    if (c.length) db.prepare(`UPDATE body_metrics SET ${c.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE date = @date`)
      .run({ ...Object.fromEntries(c.map((k) => [k, patch[k]])), date })
  } else {
    db.prepare(`INSERT INTO body_metrics (date${c.length ? ', ' + c.join(', ') : ''}) VALUES (@date${c.length ? ', ' + c.map((k) => '@' + k).join(', ') : ''})`)
      .run({ date, ...Object.fromEntries(c.map((k) => [k, patch[k]])) })
  }
  return getBodyMetric(date)
}
function listBodyMetrics(opts) { return list('body_metrics', 'date', opts) }
function deleteBodyMetric(id) { return remove('body_metrics', id) }

function savePhoto(dataUrl) {
  if (!dataDir) throw new Error('photo storage unavailable for in-memory db')
  const m = /^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '')
  if (!m) throw new Error('invalid image data url')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 8 * 1024 * 1024) throw new Error('image too large (max 8MB)')
  const dir = path.join(dataDir, 'photos')
  fs.mkdirSync(dir, { recursive: true })
  const ref = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
  fs.writeFileSync(path.join(dir, ref), buf, { mode: 0o600 })
  return ref
}
function photoPath(ref) {
  if (!dataDir || !ref || ref.includes('..') || ref.includes('/')) return null
  const p = path.join(dataDir, 'photos', ref)
  return fs.existsSync(p) ? p : null
}

// --- workout plans (Push/Pull/Legs + user-saved; items stored as JSON) ---
function parsePlan(row) { return row && { ...row, items: JSON.parse(row.items_json || '[]') } }
function listWorkoutPlans() { return db.prepare('SELECT * FROM workout_plans ORDER BY id ASC').all().map(parsePlan) }
function getWorkoutPlan(id) { return parsePlan(db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id)) }
function createWorkoutPlan({ name, kind, items }) {
  const info = db.prepare('INSERT INTO workout_plans (name, kind, items_json) VALUES (@name, @kind, @items_json)')
    .run({ name, kind: kind || null, items_json: JSON.stringify(items || []) })
  return parsePlan(db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(Number(info.lastInsertRowid)))
}
function updateWorkoutPlan(id, patch) {
  const sets = []
  const params = { id }
  if (patch.name !== undefined) { sets.push('name = @name'); params.name = patch.name }
  if (patch.kind !== undefined) { sets.push('kind = @kind'); params.kind = patch.kind }
  if (patch.items !== undefined) { sets.push('items_json = @items_json'); params.items_json = JSON.stringify(patch.items) }
  if (sets.length) { sets.push("updated_at = datetime('now')"); db.prepare(`UPDATE workout_plans SET ${sets.join(', ')} WHERE id = @id`).run(params) }
  return getWorkoutPlan(id)
}
function deleteWorkoutPlan(id) { return remove('workout_plans', id) }

// --- reminders (config + delivery attempt log; see server/reminders.cjs for due-check logic) ---
function listReminders() { return db.prepare('SELECT * FROM reminders ORDER BY id ASC').all() }
function logReminderAttempt(reminderId, date, status, detail) {
  db.prepare(`
    INSERT INTO reminder_log (reminder_id, date, status, detail) VALUES (@reminderId, @date, @status, @detail)
    ON CONFLICT(reminder_id, date) DO UPDATE SET status = @status, detail = @detail, created_at = datetime('now')
  `).run({ reminderId, date, status, detail: detail || null })
}
function reminderLogFor(date) { return db.prepare('SELECT * FROM reminder_log WHERE date = ?').all(date) }

// --- export / backup (health data only — never reminders' webhook/token targets) ---
const EXPORT_TABLES = ['workouts', 'meals', 'meal_recipes', 'body_metrics', 'habits', 'habit_defs', 'settings', 'workout_plans', 'hydration']
function exportAll() {
  const out = {}
  for (const t of EXPORT_TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all()
  return out
}
function exportTable(name) {
  return EXPORT_TABLES.includes(name) ? db.prepare(`SELECT * FROM ${name}`).all() : null
}
function importAll(data) {
  db.exec('BEGIN')
  try {
    for (const t of EXPORT_TABLES) {
      if (!Array.isArray(data[t])) continue
      db.exec(`DELETE FROM ${t}`)
      if (!data[t].length) continue
      // Only real columns of this table may be interpolated into the SQL — the import JSON
      // is untrusted, so unknown keys can't smuggle SQL into the column list.
      const valid = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
      const cols = Object.keys(data[t][0]).filter((c) => valid.has(c))
      if (!cols.length) continue
      const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      for (const row of data[t]) stmt.run(Object.fromEntries(cols.map((c) => [c, row[c] ?? null])))
    }
    ensureHabitDefsForData() // back-fill defs for any imported habit that predates this table
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { restored: Object.keys(data).filter((t) => EXPORT_TABLES.includes(t)) }
}

module.exports = {
  initDb,
  createWorkout: (w) => insert('workouts', w),
  listWorkouts,
  updateWorkout: (id, p) => update('workouts', id, p),
  deleteWorkout: (id) => remove('workouts', id),
  createMeal: (m) => insert('meals', m),
  listMeals,
  cacheNutrition,
  getNutritionDaily,
  listNutritionDaily,
  listFoodItems,
  nutritionCacheStats,
  cacheExerciseSessions,
  listExerciseSessions,
  getExerciseSession,
  exerciseCacheStats,
  cacheDailyHealth,
  getDailyHealth,
  getDailyEndpoint,
  listCachedHealthDates,
  healthCacheStats,
  updateMeal: (id, p) => update('meals', id, p),
  deleteMeal: (id) => remove('meals', id),
  duplicateMeals,
  listMealRecipes: () => db.prepare('SELECT * FROM meal_recipes ORDER BY name ASC').all(),
  createMealRecipe: (r) => insert('meal_recipes', r),
  updateMealRecipe: (id, p) => update('meal_recipes', id, p),
  deleteMealRecipe: (id) => remove('meal_recipes', id),

  getSettings,
  updateSettings,

  getHabits,
  setHabit,
  listHabits,
  createHabit,
  deleteHabit,

  getBodyMetric,
  upsertBodyMetric,
  listBodyMetrics,
  deleteBodyMetric,
  savePhoto,
  photoPath,

  listWorkoutPlans,
  getWorkoutPlan,
  createWorkoutPlan,
  updateWorkoutPlan,
  deleteWorkoutPlan,

  listReminders,
  createReminder: (r) => insert('reminders', r),
  updateReminder: (id, p) => update('reminders', id, p),
  deleteReminder: (id) => remove('reminders', id),
  logReminderAttempt,
  reminderLogFor,

  createHydration: (h) => insert('hydration', h),
  listHydration: (f) => list('hydration', 'at', f),
  deleteHydration: (id) => remove('hydration', id),

  exportAll,
  exportTable,
  importAll,
}
