const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const db = require('../server/db.cjs')

beforeEach(() => { db.initDb(':memory:') })

test('workout CRUD round-trip', () => {
  const w = db.createWorkout({ name: 'Squat', performed_at: '2026-07-01T10:00:00', sets: 3, reps: 5, weight_kg: 60 })
  assert.ok(w.id)
  assert.equal(w.name, 'Squat')
  assert.equal(db.listWorkouts({}).length, 1)
  const u = db.updateWorkout(w.id, { reps: 8 })
  assert.equal(u.reps, 8)
  assert.equal(db.deleteWorkout(w.id).deleted, true)
  assert.equal(db.listWorkouts({}).length, 0)
})

test('meal CRUD + date filter', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300, protein_g: 10 })
  db.createMeal({ name: 'Old', eaten_at: '2026-06-01T08:00:00', calories: 100 })
  assert.equal(db.listMeals({ from: '2026-07-01', to: '2026-07-02' }).length, 1)
})

test('seeded meal recipes include Chicken pulao and do not log meals', () => {
  const recipes = db.listMealRecipes()
  const pulao = recipes.find((r) => r.name === 'Chicken pulao')
  assert.ok(pulao)
  assert.equal(pulao.calories, 680)
  assert.equal(pulao.protein_g, 50)
  assert.equal(pulao.carbs_g, 64)
  assert.equal(pulao.fat_g, 24)
  assert.equal(db.listMeals({}).length, 0)
})

test('meal recipe CRUD round-trip', () => {
  const r = db.createMealRecipe({ name: 'Test bowl', calories: 500, protein_g: 40, carbs_g: 50, fat_g: 10 })
  assert.ok(r.id)
  assert.equal(db.listMealRecipes().some((x) => x.name === 'Test bowl'), true)
  const u = db.updateMealRecipe(r.id, { protein_g: 42 })
  assert.equal(u.protein_g, 42)
  assert.equal(db.deleteMealRecipe(r.id).deleted, true)
})

test('listMeals filters by meal_type and limit ("same as last dinner")', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', meal_type: 'breakfast', calories: 300 })
  db.createMeal({ name: 'Old dinner', eaten_at: '2026-06-30T19:00:00', meal_type: 'dinner', calories: 500 })
  db.createMeal({ name: 'Latest dinner', eaten_at: '2026-07-01T19:00:00', meal_type: 'dinner', calories: 700 })
  const dinners = db.listMeals({ meal_type: 'dinner', limit: 1 })
  assert.equal(dinners.length, 1)
  assert.equal(dinners[0].name, 'Latest dinner')
})

test('duplicateMeals copies a day\'s meals onto another date, preserving time-of-day', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00.000Z', meal_type: 'breakfast', calories: 300, protein_g: 10 })
  db.createMeal({ name: 'Pulao', eaten_at: '2026-07-01T19:00:00.000Z', meal_type: 'dinner', calories: 680 })
  const created = db.duplicateMeals('2026-07-01', '2026-07-02')
  assert.equal(created.length, 2)
  assert.equal(db.listMeals({ from: '2026-07-02', to: '2026-07-03' }).length, 2)
  const oats = created.find((m) => m.name === 'Oats')
  assert.equal(oats.eaten_at, '2026-07-02T08:00:00.000Z')
})

test('settings singleton: defaults null, updates persist', () => {
  const s0 = db.getSettings()
  assert.ok(s0)
  assert.equal(s0.calorie_goal, null)
  const s1 = db.updateSettings({ calorie_goal: 2200, protein_goal: 150, steps_goal: 10000, sleep_goal_min: 420, weight_goal_kg: 75, height_cm: 178 })
  assert.equal(s1.calorie_goal, 2200)
  assert.equal(s1.protein_goal, 150)
  assert.equal(s1.steps_goal, 10000)
  assert.equal(db.getSettings().height_cm, 178)
})

test('habits: set + get per date, independent per habit', () => {
  assert.deepEqual(db.getHabits('2026-07-01'), {})
  db.setHabit('2026-07-01', 'water', true)
  db.setHabit('2026-07-01', 'creatine', false)
  assert.deepEqual(db.getHabits('2026-07-01'), { water: true, creatine: false })
  db.setHabit('2026-07-01', 'water', false)
  assert.equal(db.getHabits('2026-07-01').water, false)
  assert.deepEqual(db.getHabits('2026-07-02'), {})
})

test('custom habits: definitions, defaults, streaks, and 30/60 day history windows', () => {
  assert.ok(db.listHabits('2026-07-03').some((h) => h.name === 'No sugar'))
  db.createHabit('No soda')
  db.setHabit('2026-07-01', 'No soda', true)
  db.setHabit('2026-07-02', 'No soda', true)
  let habits = db.listHabits('2026-07-03')
  let noSoda = habits.find((h) => h.name === 'No soda')
  assert.equal(noSoda.done, false)
  assert.equal(noSoda.streak, 0) // today (07-03) not logged -> streak counts only explicitly-logged days ending today
  assert.equal(noSoda.history.length, 30)
  assert.equal(noSoda.history.at(-1).date, '2026-07-03')
  assert.equal(noSoda.history.at(-2).done, true)
  db.setHabit('2026-07-03', 'No soda', true)
  noSoda = db.listHabits('2026-07-03').find((h) => h.name === 'No soda')
  assert.equal(noSoda.done, true)
  assert.equal(noSoda.streak, 3)

  db.createHabit('Long run')
  for (let i = 0; i < 31; i++) db.setHabit(new Date(Date.UTC(2026, 6, 3 - i)).toISOString().slice(0, 10), 'Long run', true)
  const longRun = db.listHabits('2026-07-03').find((h) => h.name === 'Long run')
  assert.equal(longRun.streak, 31)
  assert.equal(longRun.history.length, 60)
})

test('setHabit creates a visible custom habit definition', () => {
  db.setHabit('2026-07-01', 'No beverage', true)
  const hb = db.listHabits('2026-07-01').find((h) => h.name === 'No beverage')
  assert.ok(hb)
  assert.equal(hb.done, true)
})

test('body metrics: upsert by date + list + delete', () => {
  const created = db.upsertBodyMetric('2026-07-01', { weight_kg: 80.5, waist_cm: 90 })
  assert.equal(created.weight_kg, 80.5)
  const updated = db.upsertBodyMetric('2026-07-01', { body_fat_pct: 18 })
  assert.equal(updated.id, created.id)
  assert.equal(updated.waist_cm, 90) // untouched by second upsert
  assert.equal(updated.body_fat_pct, 18)
  assert.equal(db.listBodyMetrics({}).length, 1)
  assert.equal(db.deleteBodyMetric(created.id).deleted, true)
})

test('body metric photo: save private file + resolve path, rejects traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-mcp-test-'))
  db.initDb(path.join(dir, 'test.sqlite'))
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const ref = db.savePhoto(png1x1)
  assert.ok(ref.endsWith('.png'))
  assert.ok(db.photoPath(ref))
  assert.equal(db.photoPath('../../etc/passwd'), null)
  assert.equal(db.photoPath('nope.png'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('workout plans: seeded Push/Pull/Legs + CRUD + items round-trip', () => {
  const plans = db.listWorkoutPlans()
  const names = plans.map((p) => p.name)
  assert.ok(names.includes('Push Day'))
  assert.ok(names.includes('Pull Day'))
  assert.ok(names.includes('Leg Day'))
  assert.ok(Array.isArray(plans[0].items))
  assert.ok(plans.find((p) => p.name === 'Push Day').items.some((i) => i.name === 'Bench press'))

  const created = db.createWorkoutPlan({ name: 'Custom A', kind: 'custom', items: [{ name: 'Curl', target_sets: 3, target_reps: 12 }] })
  assert.equal(created.items.length, 1)
  const updated = db.updateWorkoutPlan(created.id, { items: [{ name: 'Curl', target_sets: 4, target_reps: 10 }] })
  assert.equal(updated.items[0].target_sets, 4)
  assert.equal(db.deleteWorkoutPlan(created.id).deleted, true)
})

test('workouts can reference a plan_id (progressive overload / plan compare join)', () => {
  const plan = db.listWorkoutPlans()[0]
  const w = db.createWorkout({ name: 'Bench press', performed_at: '2026-07-01T10:00:00', sets: 4, reps: 8, weight_kg: 60, plan_id: plan.id })
  assert.equal(w.plan_id, plan.id)
})

test('reminders: CRUD + due-check log', () => {
  const r = db.createReminder({ kind: 'water', channel: 'slack', enabled: 1, time_of_day: '09:00' })
  assert.ok(r.id)
  assert.equal(db.listReminders().length, 1)
  db.logReminderAttempt(r.id, '2026-07-01', 'skipped_not_configured', 'no webhook set')
  assert.equal(db.reminderLogFor('2026-07-01')[0].status, 'skipped_not_configured')
  const u = db.updateReminder(r.id, { enabled: 0 })
  assert.equal(u.enabled, 0)
  assert.equal(db.deleteReminder(r.id).deleted, true)
})

test('export/import round-trip preserves data and excludes reminders', () => {
  db.createWorkout({ name: 'Squat', performed_at: '2026-07-01T10:00:00', sets: 3, reps: 5, weight_kg: 60 })
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300 })
  db.updateSettings({ calorie_goal: 2200 })
  db.createReminder({ kind: 'water', channel: 'slack', target: 'https://hooks.slack.example/secret' })
  const dump = db.exportAll()
  assert.ok(!('reminders' in dump))
  assert.equal(dump.workouts.length, 1)

  db.initDb(':memory:') // fresh db to prove import restores state, not a no-op
  const res = db.importAll(dump)
  assert.ok(res.restored.includes('workouts'))
  assert.equal(db.listWorkouts({}).length, 1)
  assert.equal(db.getSettings().calorie_goal, 2200)
})

// ===== Google Health day cache =====

test('a cached day round-trips into the same shape a live pull returns', () => {
  db.cacheDailyHealth('2026-07-01', {
    activity: { summary: { steps: 8421, caloriesOut: 2310 } },
    sleep: { sleep: [{ dateOfSleep: '2026-07-01', minutesAsleep: 431 }] },
  })
  const day = db.getDailyHealth('2026-07-01')
  assert.equal(day.date, '2026-07-01')
  assert.equal(day.cached, true)
  assert.equal(day.endpoints.activity.summary.steps, 8421)
  assert.equal(day.endpoints.sleep.sleep[0].minutesAsleep, 431)
})

test('an uncached day reads back as null, not an empty shell', () => {
  assert.equal(db.getDailyHealth('2026-01-01'), null)
  assert.equal(db.getDailyEndpoint('2026-01-01', 'activity'), null)
})

test('re-caching a day overwrites it instead of duplicating the date', () => {
  db.cacheDailyHealth('2026-07-02', { activity: { summary: { steps: 100 } } })
  db.cacheDailyHealth('2026-07-02', { activity: { summary: { steps: 999 } } })
  assert.equal(db.getDailyEndpoint('2026-07-02', 'activity').summary.steps, 999)
  assert.equal(db.healthCacheStats().days, 1)
})

test('null endpoints are skipped so absent data is not stored as present-but-empty', () => {
  db.cacheDailyHealth('2026-07-03', { activity: { summary: { steps: 5 } }, ecg: null, spo2: undefined })
  const day = db.getDailyHealth('2026-07-03')
  assert.deepEqual(Object.keys(day.endpoints), ['activity'])
})

test('cache stats and date listing report the real coverage', () => {
  for (const d of ['2026-07-05', '2026-07-06', '2026-07-09']) db.cacheDailyHealth(d, { activity: { n: 1 } })
  const st = db.healthCacheStats()
  assert.equal(st.days, 3)
  assert.equal(st.first, '2026-07-05')
  assert.equal(st.last, '2026-07-09')
  assert.ok(st.bytes > 0)
  assert.deepEqual(db.listCachedHealthDates({ from: '2026-07-06', to: '2026-07-10' }), ['2026-07-06', '2026-07-09'])
})

// ===== Google Health v4 expansion: exercise sessions, workout links, richer nutrition =====

const SESSION = {
  session_id: 'users/1/dataTypes/exercise/dataPoints/7488560355854029872', date: '2026-09-02',
  start_time: '2026-09-03T00:11:05Z', end_time: '2026-09-03T00:27:46.808988094Z', utc_offset_s: -18000,
  exercise_type: 'WALKING', name: 'Walk', active_duration_s: 997, elapsed_s: 1001.8, calories_kcal: 92, distance_m: 729.9,
  steps: 1219, avg_hr_bpm: 88, avg_pace_s_per_m: 1.3659, avg_speed_m_s: null, elevation_gain_m: null, active_zone_minutes: null,
  hr_zones_min: { light: 16, moderate: 0, vigorous: 0, peak: 0 },
  events: [{ time: '2026-09-03T00:11:05Z', type: 'START' }, { time: '2026-09-03T00:27:43Z', type: 'PAUSE' }], pauses: 1,
  laps: [], splits: [], notes: null, has_gps: true, source: { platform: 'ANDROID', recording_method: 'AUTOMATICALLY_RECORDED' },
  create_time: '2026-09-03T00:17:13.796181Z', update_time: '2026-09-03T00:27:49.119938Z', raw: { exerciseType: 'WALKING' },
}

test('migration is idempotent on a DB that already has the old columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-mcp-mig-'))
  const file = path.join(dir, 'old.sqlite')
  // Pre-create the v1 tables (no session_id / nutrient columns) as a live DB would have them.
  const { DatabaseSync } = require('node:sqlite')
  const old = new DatabaseSync(file)
  old.exec(`
    CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT, name TEXT NOT NULL, performed_at TEXT NOT NULL,
      sets INTEGER, reps INTEGER, weight_kg REAL, duration_min REAL, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE gh_nutrition_daily (date TEXT PRIMARY KEY, calories REAL, protein REAL, carbs REAL, fat REAL, fiber REAL, sugar REAL, sodium REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE gh_food_items (item_key TEXT PRIMARY KEY, date TEXT NOT NULL, eaten_at TEXT, food_name TEXT, meal_type TEXT,
      calories REAL, protein REAL, carbs REAL, fat REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO workouts (name, performed_at, sets) VALUES ('Old squat', '2026-07-01T10:00:00', 3);
    INSERT INTO gh_nutrition_daily (date, calories) VALUES ('2026-07-01', 1800);
  `)
  old.close()
  db.initDb(file)
  db.initDb(file) // second boot must not throw "duplicate column"
  const cols = (t) => new Set(new DatabaseSync(file).prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
  assert.ok(cols('workouts').has('session_id'))
  assert.ok(cols('workouts').has('plan_id'))
  assert.ok(cols('gh_food_items').has('nutrients_json'))
  assert.ok(cols('gh_food_items').has('serving_amount'))
  assert.ok(cols('gh_nutrition_daily').has('cholesterol'))
  assert.equal(db.listWorkouts({})[0].name, 'Old squat') // pre-existing rows survive
  assert.equal(db.getNutritionDaily('2026-07-01').calories, 1800)
  assert.deepEqual(db.getNutritionDaily('2026-07-01').nutrients, {}) // old row: no nutrients yet, not a crash
  fs.rmSync(dir, { recursive: true, force: true })
})

test('exercise sessions: upsert twice = one row, full Session round-trips, stats + range', () => {
  assert.deepEqual(db.cacheExerciseSessions([SESSION]), { upserted: 1 })
  db.cacheExerciseSessions([{ ...SESSION, calories_kcal: 95 }])
  const st = db.exerciseCacheStats()
  assert.equal(st.sessions, 1)
  assert.equal(st.first, '2026-09-02')
  const s = db.getExerciseSession(SESSION.session_id)
  assert.equal(s.calories_kcal, 95)
  assert.equal(s.hr_light_min, 16)
  assert.equal(s.has_gps, true) // parsed json wins over the 0/1 column
  assert.equal(s.source_platform, 'ANDROID')
  assert.deepEqual(s.events, SESSION.events)
  assert.deepEqual(s.raw, SESSION.raw)
  assert.equal(db.listExerciseSessions({ from: '2026-09-02', to: '2026-09-03' }).length, 1)
  assert.equal(db.listExerciseSessions({ from: '2026-09-03', to: '2026-09-04' }).length, 0)
  assert.equal(db.getExerciseSession('nope'), null)
  // strength session: WORKOUT named by muscle group, no zones/gps
  db.cacheExerciseSessions([{ session_id: 'w2', date: '2026-09-01', exercise_type: 'WORKOUT', name: 'Back', active_duration_s: 3000, hr_zones_min: null }])
  const back = db.getExerciseSession('w2')
  assert.equal(back.name, 'Back')
  assert.equal(back.hr_light_min, null)
  assert.equal(db.exerciseCacheStats().sessions, 2)
})

test('workouts link to a session_id and listWorkouts filters on it', () => {
  const a = db.createWorkout({ name: 'Lat pulldown', performed_at: '2026-09-01T18:00:00', sets: 4, reps: 10, weight_kg: 50, session_id: 'w2' })
  db.createWorkout({ name: 'Unattached curl', performed_at: '2026-09-01T18:30:00', sets: 3, reps: 12 })
  assert.equal(a.session_id, 'w2')
  assert.equal(db.listWorkouts({ session_id: 'w2' }).length, 1)
  assert.equal(db.listWorkouts({ from: '2026-09-01', to: '2026-09-02' }).length, 2)
  assert.equal(db.listWorkouts({ from: '2026-09-01', to: '2026-09-02', session_id: 'w2' })[0].name, 'Lat pulldown')
  const b = db.updateWorkout(db.listWorkouts({}).find((w) => !w.session_id).id, { session_id: 'w2' })
  assert.equal(b.session_id, 'w2')
  assert.equal(db.listWorkouts({ session_id: 'w2' }).length, 2)
})

test('nutrition cache: new item/daily fields persist and nutrients round-trip as an object', () => {
  const nutrients = { CARBOHYDRATES: 64.9, PROTEIN: 57.6, SODIUM: 1.2 }
  db.cacheNutrition({
    daily: [{ date: '2026-09-01', calories: 576, protein: 57.6, carbs: 64.9, fat: 6.9, saturated_fat: 2, cholesterol: 0.1, nutrients }],
    items: [{
      item_key: 'users/1/dataTypes/nutrition-log/dataPoints/5531877896954618656', date: '2026-09-01', eaten_at: '2026-09-01T17:17:43',
      food_name: 'Chicken Dum biryani', meal_type: 'DINNER', calories: 576, protein: 57.6, carbs: 64.9, fat: 6.9,
      serving_amount: 1, serving_unit: 'cup', energy_from_fat: 0, fiber: null, sugar: null, sodium: 1.2, saturated_fat: 2, cholesterol: 0.1,
      food_ref: 'users/me/dataTypes/food/dataPoints/foods/2786799937787671720', nutrients,
    }],
  })
  const [it] = db.listFoodItems({ from: '2026-09-01', to: '2026-09-02' })
  assert.equal(it.serving_amount, 1)
  assert.equal(it.serving_unit, 'cup')
  assert.equal(it.energy_from_fat, 0)
  assert.equal(it.fiber, null)
  assert.equal(it.sodium, 1.2)
  assert.equal(it.saturated_fat, 2)
  assert.equal(it.cholesterol, 0.1)
  assert.equal(it.food_ref, 'users/me/dataTypes/food/dataPoints/foods/2786799937787671720')
  assert.deepEqual(it.nutrients, nutrients)
  assert.ok(!('nutrients_json' in it))
  const d = db.getNutritionDaily('2026-09-01')
  assert.equal(d.saturated_fat, 2)
  assert.equal(d.cholesterol, 0.1)
  assert.deepEqual(d.nutrients, nutrients)
  assert.deepEqual(db.listNutritionDaily({})[0].nutrients, nutrients)
  // items without nutrients read back as {} and a re-cache overwrites in place
  db.cacheNutrition({ items: [{ item_key: 'k2', date: '2026-09-01', calories: 100 }] })
  assert.deepEqual(db.listFoodItems({}).find((i) => i.item_key === 'k2').nutrients, {})
  assert.equal(db.listFoodItems({}).length, 2)
})
