// Tool-level tests for server/mcp.mjs against a fake db/googleHealth — no sqlite, no network.
// Calls go through a real MCP client over an in-memory transport so zod shapes are exercised too.
const { test } = require('node:test')
const assert = require('node:assert')

const p2 = (x) => String(x).padStart(2, '0')
const today = () => { const n = new Date(); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}` }
const YDAY = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` })()

const SID = 'users/me/dataTypes/exercise/dataPoints/7488'
const SESSIONS = [
  { session_id: SID, date: YDAY, start_time: `${YDAY}T18:00:00`, end_time: `${YDAY}T18:45:00`, exercise_type: 'WORKOUT', name: 'Back', active_duration_s: 997, calories_kcal: 210, distance_m: null, steps: null, avg_hr_bpm: 118, hr_zones_min: { light: 16, moderate: 0, vigorous: 0, peak: 0 }, pauses: 0, has_gps: false, notes: null, events: [{ time: 'x', type: 'START' }], laps: [], raw: { big: true } },
  { session_id: SID + '9', date: YDAY, start_time: `${YDAY}T07:00:00`, end_time: `${YDAY}T07:30:00`, exercise_type: 'WALKING', name: 'Walk', active_duration_s: 1800, calories_kcal: 150, distance_m: 2500, steps: 3200, avg_hr_bpm: 95, hr_zones_min: null, pauses: 1, has_gps: true, notes: null, events: [], laps: [], raw: {} },
]
const WORKOUTS = [
  { id: 1, name: 'Lat pulldown', sets: 3, reps: 10, weight_kg: 50, duration_min: null, notes: null, performed_at: `${YDAY}T18:10:00`, session_id: SID },
  { id: 2, name: 'Plank', sets: 2, reps: null, weight_kg: null, duration_min: 3, notes: 'core', performed_at: `${YDAY}T19:00:00`, session_id: null },
]
const FOODS = [
  { item_key: 'a', date: YDAY, eaten_at: `${YDAY}T08:00:00`, food_name: 'Oats', meal_type: 'BREAKFAST', serving_amount: 1, serving_unit: 'cup', calories: 300, protein: 10, carbs: 50, fat: 5, fiber: 8, sugar: 1, sodium: 0.1, saturated_fat: 1, cholesterol: 0, nutrients: { PROTEIN: 10, IRON: 0.004 } },
  { item_key: 'b', date: YDAY, eaten_at: `${YDAY}T13:00:00`, food_name: 'Rice', meal_type: 'LUNCH', serving_amount: 2, serving_unit: 'cup', calories: 400, protein: 8, carbs: 90, fat: 1, fiber: 2, sugar: 0, sodium: 0, saturated_fat: 0, cholesterol: 0, nutrients: {} },
  { item_key: 'c', date: YDAY, eaten_at: `${YDAY}T08:30:00`, food_name: 'Egg', meal_type: 'BREAKFAST', serving_amount: 2, serving_unit: 'large', calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 0, sugar: 0, sodium: 0.14, saturated_fat: 3, cholesterol: 0.37, nutrients: { CHOLESTEROL: 0.37 } },
]
const DATA_TYPES = {
  'heart-rate': { kind: 'sample', op: 'reconcile', writeOnly: false },
  exercise: { kind: 'session', op: 'reconcile', writeOnly: false },
  symptoms: { kind: 'sample', op: 'reconcile', writeOnly: true },
}

function fakes() {
  const calls = { fetch: [], query: [], get: [], cached: [], writeMeal: [], writeHydration: [], writeWeight: [], delete: [], updateGoogleHealthEntry: [] }
  const inRange = (d, { from, to }) => (!from || d >= from) && (!to || d < to)
  const meals = []
  let nextMealId = 1
  const recipes = []
  let nextRecipeId = 1
  const db = {
    listExerciseSessions: (r) => SESSIONS.filter((s) => inRange(s.date, r || {})),
    cacheExerciseSessions: (ss) => { calls.cached.push(ss); return { upserted: ss.length } },
    getExerciseSession: (id) => SESSIONS.find((s) => s.session_id === id) || null,
    exerciseCacheStats: () => ({ sessions: 2, first: YDAY, last: YDAY }),
    listWorkouts: ({ session_id, from, to } = {}) => WORKOUTS.filter((w) => (session_id ? w.session_id === session_id : inRange(w.performed_at.slice(0, 10), { from, to }))),
    updateWorkout: (id, patch) => { const w = WORKOUTS.find((x) => x.id === id); Object.assign(w, patch); return w },
    listFoodItems: (r) => FOODS.filter((f) => inRange(f.date, r)),
    getNutritionDaily: () => null,
    listMeals: ({ from, to } = {}) => meals.filter((m) => inRange(m.eaten_at, { from, to })),
    createMeal: (m) => { const row = { id: nextMealId++, google_health_name: null, ...m }; meals.push(row); return row },
    updateMeal: (id, patch) => { const row = meals.find((m) => m.id === id); Object.assign(row, patch); return row },
    deleteMeal: (id) => { const i = meals.findIndex((m) => m.id === id); if (i < 0) return { deleted: false }; meals.splice(i, 1); return { deleted: true } },
    listMealRecipes: () => recipes,
    createMealRecipe: (r) => { const row = { id: nextRecipeId++, ...r }; recipes.push(row); return row },
    updateMealRecipe: (id, patch) => { const row = recipes.find((r) => r.id === id); Object.assign(row, patch); return row },
  }
  const googleHealth = {
    DATA_TYPES,
    getHealth: async () => ({ data: null }),
    fetchExerciseSessions: async (from, to) => { calls.fetch.push([from, to]); return { sessions: [] } },
    fetchExerciseSession: async (id) => { calls.get.push(id); return { session_id: id, source: { platform: 'FITBIT', recording_method: 'ACTIVELY_MEASURED' } } },
    exportExerciseTcx: async () => '<TrainingCenterDatabase/>',
    queryDataPoints: async (t, from, to, o) => { calls.query.push([t, from, to, o]); return { data_type: t, kind: 'sample', count: 0, truncated: false, data_points: [] } },
    // Each call gets its own id (meal-1, meal-2, ...) so a test can prove duplicate_meals gives every
    // copy its own google_health_name (G5) instead of all copies sharing one fixed return value.
    writeMeal: async (p) => { calls.writeMeal.push(p); return { name: `users/me/dataTypes/nutrition-log/dataPoints/meal-${calls.writeMeal.length}`, raw: {} } },
    writeHydration: async (p) => { calls.writeHydration.push(p); return { name: 'users/me/dataTypes/hydration-log/dataPoints/water-1', raw: {} } },
    writeWeight: async (p) => { calls.writeWeight.push(p); return { name: 'users/me/dataTypes/weight/dataPoints/weight-1', raw: {} } },
    deleteGoogleHealthEntry: async (name) => { calls.delete.push(name); return { deleted: true, name } },
    updateGoogleHealthEntry: async (name, patch) => { calls.updateGoogleHealthEntry.push([name, patch]); return { name: 'users/me/dataTypes/nutrition-log/dataPoints/meal-1-NEW' } },
  }
  return { db, googleHealth, calls, meals, recipes }
}

async function client(deps) {
  const { buildServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const server = buildServer({ ...deps, summary: {}, weekly: {}, progress: {}, recommend: {}, exercises: {}, food: {}, reminders: {} })
  await server.connect(st)
  const c = new Client({ name: 't', version: '0' })
  await c.connect(ct)
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); const text = r.content[0].text; return r.isError ? { error: text } : JSON.parse(text) }
  return { call, close: () => Promise.all([c.close(), server.close()]) }
}

test('list_exercise_sessions: compact rows + logged_sets; past-only range never hits Google', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const out = await call('list_exercise_sessions', { from: YDAY, to: today() })
    assert.equal(out.count, 2)
    assert.equal(f.calls.fetch.length, 0)
    const back = out.sessions.find((s) => s.session_id === SID)
    assert.equal(back.exercise_type, 'WORKOUT'); assert.equal(back.name, 'Back'); assert.equal(back.active_min, 16.6)
    assert.deepEqual(back.logged_sets, [{ id: 1, name: 'Lat pulldown', sets: 3, reps: 10, weight_kg: 50, duration_min: null, notes: null }])
    assert.ok(!("raw" in back) && !("events" in back) && !("distance_m" in back))
    const { logged_sets, ...compact } = back; assert.ok(JSON.stringify(compact).length < 360, JSON.stringify(compact).length)
    // default range touches today → the WHOLE range is refetched (not just [today,to)), so a
    // session that synced to Google late for an already-cached day still gets picked up
    const dflt = await call('list_exercise_sessions', {})
    assert.deepEqual(f.calls.fetch, [[dflt.range.from, dflt.range.to]])
    assert.ok(dflt.range.to > today() && dflt.range.from < YDAY)
  } finally { await close() }
})

test('get_workout_day: attached vs unattached sets + totals; get_exercise_session detail + not-found', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const day = await call('get_workout_day', { date: YDAY })
    assert.equal(day.sessions.length, 2)
    assert.equal(day.sessions.find((s) => s.session_id === SID).logged_sets[0].name, 'Lat pulldown')
    assert.deepEqual(day.unattached_sets.map((w) => w.name), ['Plank'])
    assert.deepEqual(day.totals, { sessions: 2, active_min: 46.6, calories_kcal: 360 })

    const d = await call('get_exercise_session', { session_id: SID })
    assert.deepEqual(d.events, [{ time: 'x', type: 'START' }]); assert.deepEqual(d.raw, { big: true }); assert.equal(d.logged_sets.length, 1)
    // source missing in the reconcile-fed cache → one dataPoints.get, persisted, then served from cache
    assert.deepEqual(d.source, { platform: 'FITBIT', recording_method: 'ACTIVELY_MEASURED' })
    assert.deepEqual(f.calls.get, [SID]); assert.equal(f.calls.cached[0][0].source.platform, 'FITBIT')
    SESSIONS[0].source = d.source
    await call('get_exercise_session', { session_id: SID }); assert.equal(f.calls.get.length, 1)
    f.googleHealth.fetchExerciseSession = async () => { throw new Error('offline') }
    SESSIONS[1].source = null
    assert.equal((await call('get_exercise_session', { session_id: SID + '9' })).source, null, 'enrichment failure still returns the cached detail')
    const miss = await call('get_exercise_session', { session_id: 'nope' })
    assert.match(miss.error, /list_exercise_sessions/)

    const tcx = await call('export_exercise_tcx', { session_id: SID })
    assert.deepEqual(tcx, { session_id: SID, bytes: 25, trackpoints: 0, tcx: '<TrainingCenterDatabase/>' })
    const sync = await call('sync_exercise_sessions', {})
    assert.equal(sync.upserted, 0); assert.equal(sync.cache.sessions, 2)
    // default range is 31 days → chunked into 30-day windows so a long backfill can't hit the
    // 100-page reconcile ceiling and throw with nothing cached (runtime-R5)
    assert.equal(f.calls.fetch.length, 2, 'default 31-day range chunked into two windows')
    assert.equal(f.calls.fetch[0][0], sync.range.from)
    assert.equal(f.calls.fetch[1][1], sync.range.to)

    const wide = await call('sync_exercise_sessions', { from: '2021-01-01', to: '2026-09-03' })
    assert.ok(wide.range.from === '2021-01-01' && wide.range.to === '2026-09-03')
    // ~2068 days / 30 ≈ 69 windows — each one small enough to stay under the per-call page cap
    assert.ok(f.calls.fetch.length > 60)
  } finally { await close() }
})

test('get_workout_day: a set logged the next day but linked by session_id still attaches to its session, not "unattached" on either day', async () => {
  const f = fakes(); const { call, close } = await client(f)
  const lateSet = { id: 99, name: 'Deadlift', sets: 1, reps: 5, weight_kg: 100, duration_min: null, notes: null, performed_at: `${today()}T07:00:00`, session_id: SID }
  WORKOUTS.push(lateSet)
  try {
    const sessionDay = await call('get_workout_day', { date: YDAY }) // session SID is dated YDAY
    const back = sessionDay.sessions.find((s) => s.session_id === SID)
    assert.ok(back.logged_sets.some((w) => w.name === 'Deadlift'), 'set logged next-day still joins its session by id')
    assert.ok(!sessionDay.unattached_sets.some((w) => w.name === 'Deadlift'))

    const loggedDay = await call('get_workout_day', { date: today() }) // set was logged today, no session that day
    assert.ok(!loggedDay.unattached_sets.some((w) => w.name === 'Deadlift'), 'has a session_id — not unattached even though the session is on another day')
  } finally { WORKOUTS.pop(); await close() }
})

test('update_workout: session_id can be attached and detached (null)', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const plank = await call('update_workout', { id: 2, session_id: SID })
    assert.equal(plank.session_id, SID)
    const detached = await call('update_workout', { id: 2, session_id: null })
    assert.equal(detached.session_id, null)
  } finally { WORKOUTS[1].session_id = null; await close() } // restore fixture for later tests
})

test('get_food_log: serving + nutrients on items; group_by_meal buckets in day order with totals', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const flat = await call('get_food_log', { date: YDAY })
    assert.equal(flat.count, 3)
    const oats = flat.foods.find((x) => x.food === 'Oats')
    assert.deepEqual(oats.serving, { amount: 1, unit: 'cup' })
    assert.equal(oats.fiber_g, 8); assert.equal(oats.cholesterol_mg, 0); assert.deepEqual(oats.nutrients, { PROTEIN: 10, IRON: 0.004 })
    const egg = flat.foods.find((x) => x.food === 'Egg')
    assert.equal(egg.cholesterol_mg, 370) // 0.37g rounds to 0 as grams — mg keeps the trace value visible
    assert.equal(egg.sodium_mg, 140)

    const g = await call('get_food_log', { date: YDAY, group_by_meal: true })
    assert.deepEqual(Object.keys(g.meals), ['BREAKFAST', 'LUNCH'])
    assert.deepEqual(g.meals.BREAKFAST.items.map((x) => x.food), ['Oats', 'Egg'])
    assert.equal(g.meals.BREAKFAST.totals.calories, 440); assert.equal(g.meals.BREAKFAST.totals.protein_g, 22)
    assert.equal(g.totals.calories, 840); assert.equal(g.totals.carbs_g, 141)
  } finally { await close() }
})

test('query_google_health: enum from DATA_TYPES, write-only rejected, defaults forwarded', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const bad = await call('query_google_health', { data_type: 'symptoms' })
    assert.equal(bad.error, 'Error: symptoms is write-only in Google Health (create/update/batchDelete only); it cannot be read.')
    assert.equal(f.calls.query.length, 0)
    const okr = await call('query_google_health', { data_type: 'heart-rate', from: '2026-08-01', to: '2026-08-02', max_pages: 3 })
    assert.equal(okr.data_type, 'heart-rate')
    assert.deepEqual(f.calls.query, [['heart-rate', '2026-08-01', '2026-08-02', { maxPages: 3 }]])
    const unknown = await call('query_google_health', { data_type: 'not-a-type' })
    assert.match(unknown.error, /invalid|expected|not-a-type/i)
  } finally { await close() }
})

test('log_*_to_google_health: correctly shaped writes, mg passed through untouched, kg→g conversion, at defaults to now', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const meal = await call('log_meal_to_google_health', {
      at: '2026-09-01T08:00:00', food_name: 'Oats', meal_type: 'BREAKFAST', calories: 300, carbs_g: 50, fat_g: 5,
      protein_g: 10, fiber_g: 8, sugar_g: 1, sodium_mg: 140, saturated_fat_g: 1, cholesterol_mg: 370,
      serving_amount: 1, serving_unit: 'cup',
    })
    assert.equal(meal.name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1')
    assert.deepEqual(f.calls.writeMeal, [{
      startTime: '2026-09-01T08:00:00', foodDisplayName: 'Oats', mealType: 'BREAKFAST',
      servingAmount: 1, servingUnit: 'cup', calories: 300, carbsG: 50, fatG: 5, proteinG: 10,
      fiberG: 8, sugarG: 1, sodiumMg: 140, saturatedFatG: 1, cholesterolMg: 370,
    }], 'mg fields pass through untouched — the service layer converts to grams')
    assert.deepEqual(meal.logged, { at: '2026-09-01T08:00:00', food_name: 'Oats', meal_type: 'BREAKFAST', calories: 300, carbs_g: 50, fat_g: 5 })

    const water = await call('log_water_to_google_health', { at: '2026-09-01T09:00:00', milliliters: 250 })
    assert.equal(water.name, 'users/me/dataTypes/hydration-log/dataPoints/water-1')
    assert.deepEqual(f.calls.writeHydration, [{ startTime: '2026-09-01T09:00:00', milliliters: 250 }])
    // no `at` → defaults to local now, not left undefined
    await call('log_water_to_google_health', { milliliters: 500 })
    assert.match(f.calls.writeHydration[1].startTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)

    const weight = await call('log_weight_to_google_health', { at: '2026-09-01T07:00:00', weight_kg: 70.5, notes: 'am' })
    assert.equal(weight.name, 'users/me/dataTypes/weight/dataPoints/weight-1')
    assert.deepEqual(f.calls.writeWeight, [{ physicalTime: '2026-09-01T07:00:00', weightGrams: 70500, notes: 'am' }])
    assert.deepEqual(weight.logged, { at: '2026-09-01T07:00:00', weight_kg: 70.5, notes: 'am' })

    const del = await call('delete_google_health_entry', { name: meal.name })
    assert.deepEqual(del, { deleted: true, name: meal.name })
    assert.deepEqual(f.calls.delete, [meal.name])
  } finally { await close() }
})

test('update_meal: replaces the Google Health entry and stores the NEW returned name; local_only skips Google entirely', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const created = await call('log_meal', { name: 'Oats', calories: 300, eaten_at: '2026-09-01T08:00:00' })
    assert.equal(created.google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1')

    const updated = await call('update_meal', { id: created.id, calories: 350 })
    assert.equal(f.calls.updateGoogleHealthEntry.length, 1, 'a meal with a google_health_name calls the Google update path')
    assert.equal(f.calls.updateGoogleHealthEntry[0][0], 'users/me/dataTypes/nutrition-log/dataPoints/meal-1')
    assert.equal(updated.google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1-NEW', 'the row now points at the NEW data point Google returned')

    const local = await call('update_meal', { id: created.id, calories: 400, local_only: true })
    assert.equal(f.calls.updateGoogleHealthEntry.length, 1, 'local_only:true must not call Google at all')
    assert.equal(local.calories, 400, 'the local field still updates')
    assert.equal(local.google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1-NEW', 'unchanged — the Google side was skipped')
  } finally { await close() }
})

test('get_food_log: food objects expose google_health_name, the Google Health data-point id (F10)', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const flat = await call('get_food_log', { date: YDAY })
    assert.equal(flat.foods.find((x) => x.food === 'Oats').google_health_name, 'a', 'item_key from listFoodItems must survive fmtFood, not be dropped')
    assert.equal(flat.foods.find((x) => x.food === 'Rice').google_health_name, 'b')
    assert.equal(flat.foods.find((x) => x.food === 'Egg').google_health_name, 'c')
  } finally { await close() }
})

// ===== regressions caught in review of the 2026-09-04 update/delete work =====

test('delete_meal keeps the local row when the Google delete fails — it holds the only copy of the entry id', async () => {
  const f = fakes()
  f.googleHealth.deleteGoogleHealthEntry = async () => { throw new Error('Google Health will not let this app delete or change an entry logged by FITBIT') }
  const { call, close } = await client(f)
  try {
    const created = await call('log_meal', { name: 'Oats', calories: 300, eaten_at: '2026-09-01T08:00:00' })
    const out = await call('delete_meal', { id: created.id })
    assert.equal(out.deleted, false, 'the local row must survive so the Google entry stays addressable')
    assert.equal(out.google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1')
    assert.match(out.google_health_error, /FITBIT/)
    assert.equal(f.meals.length, 1, 'row still there')

    const forced = await call('delete_meal', { id: created.id, local_only: true })
    assert.equal(forced.deleted, true, 'local_only:true drops just the local row')
    assert.equal(f.meals.length, 0)
  } finally { await close() }
})

test('update_meal surfaces the warning when the replacement landed but the old Google entry survived', async () => {
  const f = fakes()
  f.googleHealth.updateGoogleHealthEntry = async () => ({ name: 'n-NEW', old_name: 'n-OLD', old_entry_deleted: false, warning: 'Created the new entry, but the old one is still there: ...' })
  const { call, close } = await client(f)
  try {
    const created = await call('log_meal', { name: 'Oats', calories: 300, eaten_at: '2026-09-01T08:00:00' })
    const out = await call('update_meal', { id: created.id, calories: 350 })
    assert.equal(out.google_health_name, 'n-NEW')
    assert.match(out.google_health_warning, /old one is still there/, 'a duplicate left in the Fitbit app must not be reported as a clean success')
  } finally { await close() }
})

// ===== recipes: log_meal_recipe + batch-macro create/update_meal_recipe (2026-09-04) =====

test('log_meal_recipe: logs a saved recipe as a meal and mirrors it to Google Health, persisting the returned google_health_name on the row (G5)', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const recipe = await call('create_meal_recipe', { name: 'Chicken pulao', calories: 680, protein_g: 50, carbs_g: 64, fat_g: 24 })
    const logged = await call('log_meal_recipe', { recipe: recipe.name, eaten_at: '2026-09-01T12:00:00' })
    assert.equal(logged.name, 'Chicken pulao')
    assert.equal(logged.calories, 680)
    assert.equal(logged.google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1')
    assert.equal(f.meals.find((m) => m.id === logged.id).google_health_name, 'users/me/dataTypes/nutrition-log/dataPoints/meal-1', 'persisted on the local row, not just the response')
    assert.equal(logged.recipe, 'Chicken pulao'); assert.equal(logged.recipe_id, recipe.id); assert.equal(logged.servings, 1)
  } finally { await close() }
})

test('log_meal_recipe: scales per-serving macros by servings and reflects the portion count in the name sent to Google', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const recipe = await call('create_meal_recipe', { name: 'Chicken pulao', calories: 680, protein_g: 50, carbs_g: 64, fat_g: 24 })
    const logged = await call('log_meal_recipe', { recipe: recipe.name, servings: 2, eaten_at: '2026-09-01T12:00:00' })
    assert.equal(logged.calories, 1360); assert.equal(logged.protein_g, 100); assert.equal(logged.carbs_g, 128); assert.equal(logged.fat_g, 48)
    assert.equal(logged.servings, 2)
    assert.equal(f.calls.writeMeal[0].foodDisplayName, 'Chicken pulao x2', 'the actual name handed to writeMeal, not just the local row, must show the portion count')
    assert.equal(f.calls.writeMeal[0].calories, 1360)
  } finally { await close() }
})

test('log_meal_recipe: local_only:true does not call Google at all, and still writes the local row', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const recipe = await call('create_meal_recipe', { name: 'Chicken pulao', calories: 680, protein_g: 50, carbs_g: 64, fat_g: 24 })
    const logged = await call('log_meal_recipe', { recipe: recipe.name, local_only: true })
    assert.equal(f.calls.writeMeal.length, 0)
    assert.equal(logged.google_health_name, null)
    assert.equal(f.meals.length, 1)
    assert.equal(logged.name, 'Chicken pulao')
  } finally { await close() }
})

test('log_meal_recipe: an unknown recipe name returns a clear error and writes nothing — no local row, no Google call', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const out = await call('log_meal_recipe', { recipe: 'Nonexistent dish' })
    assert.match(out.error, /No recipe named "Nonexistent dish"/)
    assert.equal(f.meals.length, 0)
    assert.equal(f.calls.writeMeal.length, 0)
  } finally { await close() }
})

test('log_meal_recipe: resolves a recipe case-insensitively by name, and by id', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const recipe = await call('create_meal_recipe', { name: 'Chicken Pulao', calories: 680, protein_g: 50, carbs_g: 64, fat_g: 24 })
    const byName = await call('log_meal_recipe', { recipe: 'chicken pulao', local_only: true })
    assert.equal(byName.recipe_id, recipe.id)
    const byId = await call('log_meal_recipe', { recipe: String(recipe.id), local_only: true })
    assert.equal(byId.recipe, 'Chicken Pulao')
  } finally { await close() }
})

test('create_meal_recipe: divides batch totals by servings into per-serving columns, and errors clearly with no servings to divide by', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const r = await call('create_meal_recipe', { name: 'Batch bowl', servings: 4, batch_calories: 800, batch_protein_g: 200, batch_carbs_g: 240, batch_fat_g: 80 })
    assert.equal(r.calories, 200); assert.equal(r.protein_g, 50); assert.equal(r.carbs_g, 60); assert.equal(r.fat_g, 20); assert.equal(r.servings, 4)

    const bad = await call('create_meal_recipe', { name: 'No divisor', batch_calories: 800 })
    assert.match(bad.error, /servings/i)
    assert.equal(f.recipes.some((x) => x.name === 'No divisor'), false, 'nothing is stored when the divisor is missing — never guess it')
  } finally { await close() }
})

test('create_meal_recipe: plain per-serving macros with no batch_* fields behave exactly as before', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    const r = await call('create_meal_recipe', { name: 'Simple bowl', calories: 300, protein_g: 20, carbs_g: 30, fat_g: 10 })
    assert.equal(r.calories, 300); assert.equal(r.protein_g, 20); assert.equal(r.carbs_g, 30); assert.equal(r.fat_g, 10)
    assert.equal(r.servings, undefined, 'servings is left untouched — no batch division happened')
  } finally { await close() }
})

test('duplicate_meals: mirrors each copied meal to Google and gives each copy its own google_health_name; local_only:true copies locally only', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    await call('log_meal', { name: 'Oats', calories: 300, eaten_at: '2026-08-01T08:00:00', local_only: true })
    await call('log_meal', { name: 'Pulao', calories: 680, eaten_at: '2026-08-01T19:00:00', local_only: true })

    const out = await call('duplicate_meals', { from_date: '2026-08-01', to_date: '2026-08-02' })
    assert.equal(out.copied.length, 2)
    assert.equal(out.google_health_count, 2)
    const names = out.copied.map((c) => c.google_health_name)
    assert.equal(new Set(names).size, 2, 'each copy must get its own google_health_name, not a shared one')
    assert.ok(names.every((n) => n && n.startsWith('users/me/dataTypes/nutrition-log/dataPoints/meal-')))

    const local = await call('duplicate_meals', { from_date: '2026-08-01', to_date: '2026-08-03', local_only: true })
    assert.equal(f.calls.writeMeal.length, 2, 'local_only:true must not call Google at all')
    assert.equal(local.google_health_count, 0)
    assert.ok(local.copied.every((c) => c.google_health_name === null))
  } finally { await close() }
})

test('duplicate_meals: preserves the original time-of-day on the target date', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    await call('log_meal', { name: 'Oats', calories: 300, eaten_at: '2026-08-01T08:15:00', local_only: true })
    const out = await call('duplicate_meals', { from_date: '2026-08-01', to_date: '2026-08-05', local_only: true })
    assert.equal(out.copied[0].eaten_at, '2026-08-05T08:15:00')
  } finally { await close() }
})

test('servings is rejected at zero or below — it is a divisor and a multiplier that reaches a real Google Health write', async () => {
  const f = fakes(); const { call, close } = await client(f)
  try {
    for (const servings of [0, -5]) {
      const bad = await call('create_meal_recipe', { name: `neg ${servings}`, batch_calories: 1000, servings })
      assert.ok(bad.error, `create_meal_recipe must refuse servings=${servings}`)
    }
    const ok = await call('create_meal_recipe', { name: 'Prep bowl', batch_calories: 8813, batch_protein_g: 464, servings: 10 })
    assert.equal(ok.calories, 881.3)
    assert.equal(ok.protein_g, 46.4)

    const negLog = await call('log_meal_recipe', { recipe: 'Prep bowl', servings: -2 })
    assert.ok(negLog.error, 'log_meal_recipe must refuse negative servings')
    assert.equal(f.calls.writeMeal.length, 0, 'nothing may reach Google Health')

    // half a box is a real thing — positive, not integer
    const half = await call('log_meal_recipe', { recipe: 'Prep bowl', servings: 0.5 })
    assert.equal(half.calories, 440.65)
    assert.equal(f.calls.writeMeal.length, 1)
  } finally { await close() }
})
