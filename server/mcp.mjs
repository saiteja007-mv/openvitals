// Health MCP server — exposes the single-user health data as MCP tools over
// Streamable HTTP at /mcp. Bearer-token gated. Deps (db, googleHealth, summary, weekly,
// progress, recommend, exercises, food, reminders) are injected by index.cjs so this
// module stays SDK-only. Stateless: one server+transport per request.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const isoDay = (d) => d.toISOString().slice(0, 10)
// LOCAL "today" (not UTC) so evening calls don't roll to tomorrow's empty day.
const p2 = (x) => String(x).padStart(2, '0')
const today = () => { const n = new Date(); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}` }
// LOCAL now as an ISO-ish datetime (no Z) so a logged item's date part = local today,
// otherwise an evening log gets a UTC-tomorrow stamp and won't show under today.
const localNow = () => { const n = new Date(); return `${today()}T${p2(n.getHours())}:${p2(n.getMinutes())}:${p2(n.getSeconds())}` }
const shift = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d) }
const nextDay = (dateStr) => shift(dateStr, 1)
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj ?? null, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: 'Error: ' + (e?.message || e) }], isError: true })
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})) } catch (e) { return fail(e) } }

// Google Health endpoint keys present in the cached sync payload.
const HEALTH_METRICS = ['profile', 'devices', 'activity', 'activityGoals', 'stepsIntraday', 'caloriesIntraday', 'heartIntraday', 'sleep', 'sleepTrend', 'sleepGoal', 'stepsTrend', 'caloriesTrend', 'heartTrend', 'metricTrends', 'bodyWeight', 'bodyFat', 'weightGoal', 'water', 'waterGoal', 'food', 'breathing', 'hrv', 'spo2', 'skinTemperature', 'coreTemperature', 'cardio', 'ecg', 'activities', 'identity', 'bloodGlucose']

function buildServer(d) {
  const { db, googleHealth, summary, weekly, progress, recommend, exercises, food, reminders } = d
  const s = new McpServer({ name: 'health-mcp', version: '2.0.0' })
  const health = () => googleHealth.getHealth().then((h) => h?.data ?? null).catch(() => null)
  const ep = async (key) => { const c = await health(); return c?.endpoints?.[key] ?? null }
  const T = (name, desc, shape, fn) => s.tool(name, desc, shape, wrap(fn))
  const planItem = z.object({ name: z.string(), exercise_id: z.string().optional(), target_sets: z.number().optional(), target_reps: z.number().optional(), target_weight_kg: z.number().optional() })

  // ===== Google Health data points (read-only — Google Health has no write API) =====
  T('get_status', 'App + Google-Health sync status.', {}, async () => ({ app: 'health-mcp', googleHealth: await googleHealth.getStatus() }))
  T('get_health', 'Full raw cached Google Health payload (all endpoints).', {}, () => googleHealth.getHealth())
  T('get_health_metric', 'Read one Google Health data point by name.',
    { metric: z.enum(HEALTH_METRICS).describe('which health endpoint to read') }, ({ metric }) => ep(metric))
  T('get_activity', 'Steps, calories out, distance, floors, active/zone/sedentary minutes (+ goals + trends).', {},
    async () => ({ activity: await ep('activity'), goals: await ep('activityGoals'), trends: await ep('metricTrends') }))
  T('get_heart', 'Heart rate: intraday, trend, resting, HRV, cardio fitness.', {},
    async () => ({ intraday: await ep('heartIntraday'), trend: await ep('heartTrend'), hrv: await ep('hrv'), cardio: await ep('cardio') }))
  T('get_sleep', 'Sleep sessions, sleep trend, and sleep goal.', {},
    async () => ({ sleep: await ep('sleep'), trend: await ep('sleepTrend'), goal: await ep('sleepGoal') }))
  T('get_hydration', 'Google Health water intake + water goal (use list_hydration for your own logged water).', {},
    async () => ({ water: await ep('water'), goal: await ep('waterGoal') }))
  T('get_nutrition_intake', 'Google Health nutrition/food intake (calories in).', {}, () => ep('food'))
  T('get_body_composition', 'Google Health body weight, body fat, and weight goal.', {},
    async () => ({ weight: await ep('bodyWeight'), bodyFat: await ep('bodyFat'), goal: await ep('weightGoal') }))
  T('get_glucose', 'Blood glucose readings.', {}, () => ep('bloodGlucose'))
  T('get_spo2', 'Blood oxygen saturation (SpO2).', {}, () => ep('spo2'))
  T('get_breathing', 'Breathing / respiratory rate.', {}, () => ep('breathing'))
  T('get_temperature', 'Skin and core body temperature.', {}, async () => ({ skin: await ep('skinTemperature'), core: await ep('coreTemperature') }))
  T('get_devices', 'Connected Google Health devices.', {}, () => ep('devices'))
  T('sync_google_health', 'Pull the latest Google Health data into the health store.', {}, () => googleHealth.sync())

  // ===== Summaries / recommendation / export =====
  T('get_daily_summary', 'Full day summary: health, workouts, meals, nutrition, calorie balance.',
    { date: z.string().describe('YYYY-MM-DD; default today').optional() },
    async ({ date }) => { const dt = date || today(); return summary.daySummary(dt, { cached: await health(), workouts: db.listWorkouts({ from: dt, to: nextDay(dt) }), meals: db.listMeals({ from: dt, to: nextDay(dt) }) }) })
  T('get_weekly_summary', 'Rolling multi-day summary (averages, insights, best/worst day).',
    { days: z.number().int().min(1).max(31).optional() },
    async ({ days }) => { const n = days || 7, to = today(), from = shift(to, -(n - 1)), cached = await health(), settings = db.getSettings(), arr = []; for (let dt = from; dt <= to; dt = nextDay(dt)) arr.push(summary.daySummary(dt, { cached, workouts: db.listWorkouts({ from: dt, to: nextDay(dt) }), meals: db.listMeals({ from: dt, to: nextDay(dt) }) })); return { from, to, ...weekly.weeklySummary(arr, settings) } })
  T('get_recommendation', 'Weight-trajectory recommendation from recent intake/output vs goal.', {}, async () => {
    const settings = db.getSettings(), cached = await health(), t = today()
    const byDate = {}; for (const r of (cached?.endpoints?.bodyWeight?.weight) || []) { const dd = r.dateTime || r.date; if (dd && r.weight != null) byDate[dd] = r.weight }
    const weightSeries = Object.keys(byDate).sort().map((date) => ({ date, value: byDate[date] }))
    const meals14 = db.listMeals({ from: shift(t, -13), to: nextDay(t) })
    const avgCaloriesIn = summary.nutritionTotals(meals14).calIn / 14
    let outSum = 0, outCount = 0
    for (let i = 0; i < 14; i++) { const h = summary.extractHealthMetrics(cached, shift(t, -i)); if (h.caloriesOut != null) { outSum += h.caloriesOut; outCount++ } }
    const currentWeightKg = weightSeries.length ? weightSeries[weightSeries.length - 1].value : summary.extractHealthMetrics(cached, t).weightKg
    return recommend.recommend({ weightSeries, avgCaloriesIn, avgCaloriesOut: outCount ? outSum / outCount : null, currentWeightKg, goalWeightKg: settings.weight_goal_kg })
  })
  T('export_all', 'Export the entire health database (all tables) as JSON.', {}, () => db.exportAll())

  // ===== Workouts =====
  T('list_workouts', 'Logged workouts in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listWorkouts({ from, to }))
  T('log_workout', 'Log a completed exercise set.',
    { name: z.string(), sets: z.number().optional(), reps: z.number().optional(), weight_kg: z.number().optional(), duration_min: z.number().optional(), exercise_id: z.string().optional(), plan_id: z.number().optional(), notes: z.string().optional(), performed_at: z.string().optional() },
    (a) => db.createWorkout({ ...a, performed_at: a.performed_at || localNow() }))
  T('update_workout', 'Update fields of a logged workout by id.',
    { id: z.number(), name: z.string().optional(), sets: z.number().optional(), reps: z.number().optional(), weight_kg: z.number().optional(), duration_min: z.number().optional(), notes: z.string().optional() },
    ({ id, ...p }) => db.updateWorkout(id, p))
  T('delete_workout', 'Delete a logged workout by id.', { id: z.number() }, ({ id }) => db.deleteWorkout(id))
  T('get_progress', 'Per-exercise strength progress (max weight / est. 1RM over time).', {}, () => progress.computeProgress(db.listWorkouts({})))

  // ===== Workout plans =====
  T('list_workout_plans', 'Saved workout plans/routines with their exercises.', {}, () => db.listWorkoutPlans())
  T('create_workout_plan', 'Create a workout plan/routine.',
    { name: z.string(), kind: z.string().optional(), items: z.array(planItem).optional() },
    ({ name, kind, items }) => db.createWorkoutPlan({ name, kind, items: items || [] }))
  T('update_workout_plan', 'Update a workout plan by id.',
    { id: z.number(), name: z.string().optional(), kind: z.string().optional(), items: z.array(planItem).optional() },
    ({ id, ...p }) => db.updateWorkoutPlan(id, p))
  T('delete_workout_plan', 'Delete a workout plan by id.', { id: z.number() }, ({ id }) => db.deleteWorkoutPlan(id))
  T('compare_plan_vs_logged', 'Compare a plan’s prescribed exercises vs what you logged on a date.',
    { plan_id: z.number(), date: z.string().optional() },
    ({ plan_id, date }) => { const plan = db.getWorkoutPlan(plan_id); if (!plan) throw new Error('plan not found'); const dt = date || today(); const logged = db.listWorkouts({ from: dt, to: nextDay(dt) }).filter((w) => w.plan_id === plan.id); return { plan, date: dt, planned: plan.items, logged } })

  // ===== Meals & nutrition =====
  T('list_meals', 'Logged meals in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listMeals({ from, to }))
  T('log_meal', 'Log a meal with nutrition macros.',
    { name: z.string(), meal_type: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(), eaten_at: z.string().optional() },
    (a) => db.createMeal({ ...a, eaten_at: a.eaten_at || localNow() }))
  T('update_meal', 'Update a logged meal by id.',
    { id: z.number(), name: z.string().optional(), meal_type: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional() },
    ({ id, ...p }) => db.updateMeal(id, p))
  T('delete_meal', 'Delete a logged meal by id.', { id: z.number() }, ({ id }) => db.deleteMeal(id))
  T('duplicate_meals', 'Copy all meals from one date to another (e.g. repeat yesterday).',
    { from_date: z.string().describe('YYYY-MM-DD'), to_date: z.string().describe('YYYY-MM-DD') },
    ({ from_date, to_date }) => db.duplicateMeals(from_date, to_date))
  T('search_food', 'Search foods for nutrition facts (calories + macros per serving).', { query: z.string() }, ({ query }) => food.searchFood(query))
  T('lookup_barcode', 'Look up a packaged food by barcode for nutrition facts.', { code: z.string() }, ({ code }) => food.lookupBarcode(code))
  T('list_meal_recipes', 'Saved meal templates/recipes.', {}, () => db.listMealRecipes())
  T('create_meal_recipe', 'Save a reusable meal template with its macros.',
    { name: z.string(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional() },
    (a) => db.createMealRecipe(a))
  T('update_meal_recipe', 'Update a meal template by id.',
    { id: z.number(), name: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional() },
    ({ id, ...p }) => db.updateMealRecipe(id, p))
  T('delete_meal_recipe', 'Delete a meal template by id.', { id: z.number() }, ({ id }) => db.deleteMealRecipe(id))

  // ===== Hydration (local hydration log; Google Health water is read-only) =====
  T('log_hydration', 'Log water intake in milliliters.',
    { ml: z.number(), at: z.string().describe('ISO datetime; default now').optional(), notes: z.string().optional() },
    (a) => db.createHydration({ ...a, at: a.at || localNow() }))
  T('list_hydration', 'Your logged water intake in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listHydration({ from, to }))
  T('delete_hydration', 'Delete a hydration log entry by id.', { id: z.number() }, ({ id }) => db.deleteHydration(id))

  // ===== Body =====
  T('list_body_metrics', 'Body measurements (weight, body fat, waist, chest, arm) in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listBodyMetrics({ from, to }))
  T('upsert_body_metric', 'Record/update body measurements for a date.',
    { date: z.string().optional(), weight_kg: z.number().optional(), body_fat_pct: z.number().optional(), waist_cm: z.number().optional(), chest_cm: z.number().optional(), arm_cm: z.number().optional(), notes: z.string().optional() },
    ({ date, ...patch }) => db.upsertBodyMetric(date || today(), patch))
  T('delete_body_metric', 'Delete a body-metric entry by id.', { id: z.number() }, ({ id }) => db.deleteBodyMetric(id))

  // ===== Habits =====
  T('list_habits', 'Habit definitions with done/not-done for a date.', { date: z.string().optional() }, ({ date }) => db.listHabits(date || today()))
  T('set_habit', 'Mark a habit done/undone for a date (creates it if new).',
    { habit: z.string(), done: z.boolean(), date: z.string().optional() },
    ({ habit, done, date }) => { db.setHabit(date || today(), habit, done); return { habit, done, date: date || today() } })
  T('create_habit', 'Create a habit definition.', { name: z.string() }, ({ name }) => db.createHabit(name))
  T('delete_habit', 'Delete a habit definition by name.', { name: z.string() }, ({ name }) => db.deleteHabit(name))

  // ===== Settings / goals =====
  T('get_settings', 'Goals: calories, protein, steps, sleep, target weight, height.', {}, () => db.getSettings())
  T('update_settings', 'Update goals (calorie/protein/steps/sleep/weight/height).',
    { calorie_goal: z.number().optional(), protein_goal: z.number().optional(), steps_goal: z.number().optional(), sleep_goal_min: z.number().optional(), weight_goal_kg: z.number().optional(), height_cm: z.number().optional() },
    (patch) => db.updateSettings(patch))

  // ===== Exercise catalog =====
  T('search_exercises', 'Search the exercise library by name/body part/equipment/target.',
    { q: z.string().optional(), bodyPart: z.string().optional(), equipment: z.string().optional(), target: z.string().optional(), limit: z.number().optional(), offset: z.number().optional() },
    (a) => exercises.searchExercises(a))
  T('get_exercise', 'Get one exercise (with instructions) by id.', { id: z.string() }, ({ id }) => exercises.getExercise(id))
  T('get_exercise_facets', 'Available body parts / equipment / targets to filter exercises by.', {}, () => exercises.facets())

  // ===== Reminders =====
  T('list_reminders', 'Configured reminders.', {}, () => db.listReminders())
  T('create_reminder', 'Create a reminder.',
    { kind: z.string(), channel: z.string().optional(), enabled: z.boolean().optional(), time_of_day: z.string().describe('HH:MM').optional(), target: z.string().optional() },
    (a) => db.createReminder({ ...a, enabled: a.enabled === undefined ? 1 : (a.enabled ? 1 : 0) }))
  T('update_reminder', 'Update a reminder by id.',
    { id: z.number(), kind: z.string().optional(), channel: z.string().optional(), enabled: z.boolean().optional(), time_of_day: z.string().optional(), target: z.string().optional() },
    ({ id, enabled, ...p }) => db.updateReminder(id, { ...p, ...(enabled === undefined ? {} : { enabled: enabled ? 1 : 0 }) }))
  T('delete_reminder', 'Delete a reminder by id.', { id: z.number() }, ({ id }) => db.deleteReminder(id))
  T('get_due_reminders', 'Reminders currently due (by time of day, not yet logged today).', {},
    () => reminders.dueReminders(db.listReminders(), db.reminderLogFor(today()), new Date()))

  return s
}

export function createMcpHandler(deps) {
  const token = deps.token
  return async function handleMcp(req, res, bodyRaw) {
    const authz = req.headers['authorization'] || ''
    const provided = authz.startsWith('Bearer ') ? authz.slice(7) : (req.headers['x-api-key'] || '')
    if (!token || provided !== token) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="health-mcp"' })
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: valid bearer token required' }, id: null }))
    }
    const server = buildServer(deps)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    let body
    if (bodyRaw) { try { body = JSON.parse(bodyRaw) } catch { /* let transport 400 it */ } }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }
}
