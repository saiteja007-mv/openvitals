// Health MCP server — exposes the single-user health data as MCP tools over
// Streamable HTTP at /mcp. Bearer-token gated. Deps (db, googleHealth, summary, weekly,
// progress, recommend, exercises, food, reminders) are injected by index.cjs so this
// module stays SDK-only. Stateless: one server+transport per request.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

// One version, from package.json — the server string and the npm version had drifted apart (2.0.0 vs 0.1.0).
const { version: VERSION } = createRequire(import.meta.url)('../package.json')

// Constant-time token compare — same approach as auth.cjs, so a network timing side channel
// can't leak the bearer token byte by byte.
function tokenEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

const isoDay = (d) => d.toISOString().slice(0, 10)
// LOCAL "today" (not UTC) so evening calls don't roll to tomorrow's empty day.
const p2 = (x) => String(x).padStart(2, '0')
const today = () => { const n = new Date(); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}` }
// LOCAL now as an ISO-ish datetime (no Z) so a logged item's date part = local today,
// otherwise an evening log gets a UTC-tomorrow stamp and won't show under today.
const localNow = () => { const n = new Date(); return `${today()}T${p2(n.getHours())}:${p2(n.getMinutes())}:${p2(n.getSeconds())}` }
const shift = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d) }
const nextDay = (dateStr) => shift(dateStr, 1)
const r0 = (v) => (v == null ? null : Math.round(v))
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
// Google reports sodium/cholesterol in grams at trace scale (0.005-0.125g) — r1 rounds every
// real-world value to 0. mg keeps the precision that matters for these two.
const mg = (v) => (v == null ? null : Math.round(v * 1000))
// serving is "1 cup" style — Google splits amount/unit; keep both so a re-log can reuse the unit.
const fmtFood = (i) => ({
  // the addressable Google Health data point id — what update_google_health_entry / delete_google_health_entry take
  google_health_name: i.item_key ?? null,
  time: i.eaten_at ? i.eaten_at.slice(11, 16) : null, meal: i.meal_type, food: i.food_name,
  serving: i.serving_amount != null || i.serving_unit ? { amount: i.serving_amount ?? null, unit: i.serving_unit ?? null } : null,
  calories: r0(i.calories), protein_g: r1(i.protein), carbs_g: r1(i.carbs), fat_g: r1(i.fat),
  fiber_g: r1(i.fiber), sugar_g: r1(i.sugar), sodium_mg: mg(i.sodium), saturated_fat_g: r1(i.saturated_fat), cholesterol_mg: mg(i.cholesterol),
  nutrients: i.nutrients || {},
})
const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg']
const sumMacros = (foods) => Object.fromEntries(MACROS.map((k) => [k, r1(foods.reduce((a, f) => a + (f[k] || 0), 0))]))
// Google's NutritionLog.mealType enum, in day order — group_by_meal emits meals in this order.
const MEAL_ORDER = ['BEFORE_BREAKFAST', 'BREAKFAST', 'BEFORE_LUNCH', 'LUNCH', 'BEFORE_DINNER', 'DINNER', 'AFTER_DINNER', 'SNACK', 'ANYTIME']
const mealRank = (m) => { const i = MEAL_ORDER.indexOf(m); return i < 0 ? MEAL_ORDER.length : i }
const dropNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))
// Compact session for lists (≤ ~300 B): no raw/events/laps/splits (get_exercise_session has those),
// nulls dropped — an indoor WORKOUT has no distance/steps/gps and listing that is noise.
const fmtSession = (s) => dropNulls({
  session_id: s.session_id, date: s.date, start_time: s.start_time, end_time: s.end_time, exercise_type: s.exercise_type, name: s.name,
  active_min: s.active_duration_s == null ? null : r1(s.active_duration_s / 60), calories_kcal: r0(s.calories_kcal), distance_m: r0(s.distance_m),
  steps: s.steps ?? null, avg_hr_bpm: r0(s.avg_hr_bpm), active_zone_minutes: s.active_zone_minutes ?? null, hr_zones_min: s.hr_zones_min ?? null,
  pauses: s.pauses ?? null, has_gps: s.has_gps ?? null, notes: s.notes ?? null,
})
// A logged set attached to a session. id kept so the caller can update_workout/delete_workout it.
const fmtSet = (w) => ({ id: w.id, name: w.name, sets: w.sets, reps: w.reps, weight_kg: w.weight_kg, duration_min: w.duration_min, notes: w.notes })
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj ?? null, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: 'Error: ' + (e?.message || e) }], isError: true })
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})) } catch (e) { return fail(e) } }

// Google Health endpoint keys present in the cached sync payload.
const HEALTH_METRICS = ['profile', 'devices', 'activity', 'activityGoals', 'stepsIntraday', 'caloriesIntraday', 'heartIntraday', 'sleep', 'sleepTrend', 'sleepGoal', 'stepsTrend', 'caloriesTrend', 'heartTrend', 'metricTrends', 'bodyWeight', 'bodyFat', 'weightGoal', 'water', 'waterGoal', 'food', 'breathing', 'hrv', 'spo2', 'skinTemperature', 'coreTemperature', 'cardio', 'ecg', 'activities', 'identity', 'bloodGlucose', 'heartRateZones', 'breathingSleep']

export function buildServer(d) {
  const { db, googleHealth, summary, weekly, progress, recommend, exercises, food, reminders } = d
  const s = new McpServer({ name: 'health-mcp', version: VERSION })
  // date is optional and defaults to today. A past date is served from the local gh_daily
  // cache with no Google API call; today always goes live.
  const health = (date) => googleHealth.getHealth(date).then((h) => h?.data ?? null).catch(() => null)
  const ep = async (key, date) => { const c = await health(date); return c?.endpoints?.[key] ?? null }
  const onDate = { date: z.string().describe('YYYY-MM-DD; default today. Past dates come from the local cache.').optional() }
  const T = (name, desc, shape, fn) => s.tool(name, desc, shape, wrap(fn))
  const range = { from: z.string().describe('YYYY-MM-DD').optional(), to: z.string().describe('YYYY-MM-DD, exclusive').optional() }
  // Cache-first sessions for [from,to). A finished day never changes, so a range fully in the
  // past comes straight from disk. Refetch the WHOLE range (not just [today,to)) when asked, when
  // the cache has nothing for it (never synced), or when the range touches today — a session can
  // land on Google well after its civil day ends (watch/phone sync lag, edits in the Fitbit app),
  // so a partial-touch refetch would permanently miss anything that synced late for an already-
  // cached day. Cost is bounded: exercise pages at 25/call and typical ranges are ≤30 days.
  const sessionsFor = async (from, to, refresh) => {
    let rows = db.listExerciseSessions({ from, to })
    const liveFrom = refresh || !rows.length || to > today() ? from : null
    if (liveFrom) {
      const { sessions } = await googleHealth.fetchExerciseSessions(liveFrom, to)
      db.cacheExerciseSessions(sessions)
      rows = db.listExerciseSessions({ from, to })
    }
    return rows
  }
  const withSets = (s) => ({ ...s, logged_sets: db.listWorkouts({ session_id: s.session_id }).map(fmtSet) })
  const planItem = z.object({ name: z.string(), exercise_id: z.string().optional(), target_sets: z.number().optional(), target_reps: z.number().optional(), target_weight_kg: z.number().optional() })

  // ===== Google Health data points (read-only here; the v4 API also supports create/patch/batchDelete
  // under *.writeonly scopes, which this server does not request) =====
  T('get_status', 'App + Google-Health sync status.', {}, async () => ({ app: 'health-mcp', googleHealth: await googleHealth.getStatus() }))
  T('get_health', 'Full raw Google Health payload (all endpoints) for a date. Defaults to today (live); past dates are served from the local cache.',
    onDate, ({ date }) => googleHealth.getHealth(date))
  T('get_health_metric', 'Read one Google Health data point by name, for a date (default today).',
    { metric: z.enum(HEALTH_METRICS).describe('which health endpoint to read'), ...onDate }, ({ metric, date }) => ep(metric, date))
  T('get_activity', 'Steps, calories out, distance, floors, active/zone/sedentary minutes (+ goals + trends).', onDate,
    async ({ date }) => ({ activity: await ep('activity', date), goals: await ep('activityGoals', date), trends: await ep('metricTrends', date) }))
  T('get_heart', 'Heart rate: intraday, trend, resting, HRV, cardio fitness, and the day\'s HR zone boundaries (bpm min/max per zone). Note: intraday is live-only and absent for cached past dates.', onDate,
    async ({ date }) => ({ intraday: await ep('heartIntraday', date), trend: await ep('heartTrend', date), hrv: await ep('hrv', date), cardio: await ep('cardio', date), zones: await ep('heartRateZones', date) }))
  T('get_sleep', 'Sleep sessions, sleep trend, and sleep goal.', onDate,
    async ({ date }) => ({ sleep: await ep('sleep', date), trend: await ep('sleepTrend', date), goal: await ep('sleepGoal', date) }))
  T('get_hydration', 'Google Health water intake + water goal (use list_hydration for your own logged water).', onDate,
    async ({ date }) => ({ water: await ep('water', date), goal: await ep('waterGoal', date) }))
  T('get_health_cache_status', 'Which dates of Google Health history are stored locally (days, range, size).', {},
    () => ({ ...googleHealth.cacheStats(), note: 'Past dates in this range are served from disk with no Google API call. Extend it with backfill_google_health.' }))
  T('backfill_google_health', 'Fetch and locally cache Google Health history for a date range so past dates load without hitting the API. from/to are YYYY-MM-DD (to is exclusive). Capped at 8 days per call because each date costs ~31 rate-limited API calls; for a longer backfill run `node server/backfill-gh.cjs <from> <to>` on the host instead.',
    { from: z.string(), to: z.string(), force: z.boolean().optional() },
    async ({ from, to, force }) => {
      const span = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86_400_000)
      if (!(span > 0)) return { error: 'to must be after from' }
      if (span > 8) return { error: `range is ${span} days; this tool is capped at 8. Run: node server/backfill-gh.cjs ${from} ${to}` }
      return googleHealth.backfill(from, to, { force: Boolean(force) })
    })
  T('get_nutrition_intake', 'Calories + full macros (protein/carbs/fat/fiber) AND the list of foods you ate on a date, from your Google Health food log (cached by sync_nutrition_cache). Falls back to live Google Health calories, then meals logged via this tool. Defaults to today. Each food carries google_health_name, the id to pass to update_google_health_entry or delete_google_health_entry; entries logged in the Fitbit app can only be edited in that app.',
    { date: z.string().optional() },
    async ({ date }) => {
      const dt = date || today()
      const foods = db.listFoodItems({ from: dt, to: nextDay(dt) }).map(fmtFood)
      const cached = db.getNutritionDaily(dt)
      if (cached) {
        return {
          date: dt, source: 'google_health',
          calories: r0(cached.calories), protein_g: r1(cached.protein), carbs_g: r1(cached.carbs),
          fat_g: r1(cached.fat), fiber_g: r1(cached.fiber), sugar_g: r1(cached.sugar), sodium_mg: mg(cached.sodium),
          saturated_fat_g: r1(cached.saturated_fat), cholesterol_mg: mg(cached.cholesterol), nutrients: cached.nutrients || {},
          foods, cachedAt: cached.updated_at,
        }
      }
      // Not cached — fall back to live metricTrends (calories only), then locally-logged meals.
      const live = (await health())?.endpoints?.metricTrends?.values?.find((r) => r.dateTime === dt)
      const gCal = live && live.caloriesIn != null ? Math.round(live.caloriesIn) : null
      const meals = db.listMeals({ from: dt, to: nextDay(dt) })
      const logged = summary.nutritionTotals(meals)
      return {
        date: dt,
        source: gCal != null ? 'google_health_live' : (meals.length ? 'logged_meals' : 'no_data'),
        calories: gCal != null ? gCal : (meals.length ? logged.calIn : null),
        protein_g: meals.length ? logged.protein : null, carbs_g: meals.length ? logged.carbs : null, fat_g: meals.length ? logged.fat : null,
        foods,
        note: 'This date is not in the nutrition cache (macros + foods). Run sync_nutrition_cache to backfill it.',
      }
    })
  T('get_food_log', 'The individual foods/items you logged on a date from Google Health: name, meal type, time, serving {amount, unit}, calories, protein/carbs/fat/fiber/sugar/saturated fat (grams), sodium/cholesterol (milligrams — trace amounts round to 0 in grams), and a `nutrients` object with every nutrient Google recorded (e.g. CALCIUM, IRON, VITAMIN_C in grams). Defaults to today. group_by_meal buckets items by meal type in day order with per-meal totals. Each food carries google_health_name, the id to pass to update_google_health_entry or delete_google_health_entry; entries logged in the Fitbit app can only be edited in that app.',
    { date: z.string().optional(), group_by_meal: z.boolean().optional() },
    ({ date, group_by_meal }) => {
      const dt = date || today()
      const foods = db.listFoodItems({ from: dt, to: nextDay(dt) }).map(fmtFood)
      if (!group_by_meal) return { date: dt, count: foods.length, foods }
      const meals = {}
      for (const m of [...new Set(foods.map((f) => f.meal || 'ANYTIME'))].sort((a, b) => mealRank(a) - mealRank(b))) {
        const items = foods.filter((f) => (f.meal || 'ANYTIME') === m)
        meals[m] = { items, totals: sumMacros(items) }
      }
      return { date: dt, count: foods.length, meals, totals: sumMacros(foods) }
    })
  T('sync_nutrition_cache', 'Fetch nutrition (daily macro totals + individual food items) from Google Health for a date range and cache it locally. Defaults to the last 14 days; pass a wider range to backfill. from/to are YYYY-MM-DD (to is exclusive).',
    { from: z.string().optional(), to: z.string().optional() },
    async ({ from, to }) => {
      const toDate = to || nextDay(today())
      const fromDate = from || shift(today(), -14)
      const { daily, items } = await googleHealth.fetchNutrition(fromDate, toDate)
      const counts = db.cacheNutrition({ daily, items })
      return { range: { from: fromDate, to: toDate }, ...counts, cache: db.nutritionCacheStats() }
    })
  T('get_body_composition', 'Google Health body weight, body fat, and weight goal.', {},
    async () => ({ weight: await ep('bodyWeight'), bodyFat: await ep('bodyFat'), goal: await ep('weightGoal') }))
  T('get_glucose', 'Blood glucose readings.', {}, () => ep('bloodGlucose'))
  T('get_spo2', 'Blood oxygen saturation (SpO2).', {}, () => ep('spo2'))
  T('get_breathing', 'Breathing / respiratory rate, plus per-sleep-stage breathing (deep/light/rem/full: bpm, sd, snr).', onDate,
    async ({ date }) => ({ breathing: await ep('breathing', date), sleep_stages: await ep('breathingSleep', date) }))
  T('get_temperature', 'Skin and core body temperature.', {}, async () => ({ skin: await ep('skinTemperature'), core: await ep('coreTemperature') }))
  T('get_devices', 'Connected Google Health devices.', {}, () => ep('devices'))
  T('sync_google_health', 'Pull the latest Google Health data into the health store.', {}, () => googleHealth.sync())

  // ===== Summaries / recommendation / export =====
  T('get_daily_summary', 'Full day summary: health, workouts, meals, nutrition, calorie balance.',
    { date: z.string().describe('YYYY-MM-DD; default today').optional() },
    async ({ date }) => {
      const dt = date || today()
      const s = summary.daySummary(dt, { cached: await health(), workouts: db.listWorkouts({ from: dt, to: nextDay(dt) }), meals: db.listMeals({ from: dt, to: nextDay(dt) }), ghNutrition: db.getNutritionDaily(dt) })
      const gh = db.getNutritionDaily(dt)
      if (gh) {
        s.nutrition = { calIn: r0(gh.calories), protein: r1(gh.protein), carbs: r1(gh.carbs), fat: r1(gh.fat), fiber: r1(gh.fiber), caloriesInSource: 'google_health', foods: db.listFoodItems({ from: dt, to: nextDay(dt) }).map(fmtFood) }
        s.balance = summary.calorieBalance({ calIn: gh.calories, caloriesOut: s.health.caloriesOut })
      }
      return s
    })
  T('get_weekly_summary', 'Rolling multi-day summary (averages, insights, best/worst day).',
    { days: z.number().int().min(1).max(31).optional() },
    async ({ days }) => { const n = days || 7, to = today(), from = shift(to, -(n - 1)), cached = await health(), settings = db.getSettings(), arr = []; for (let dt = from; dt <= to; dt = nextDay(dt)) arr.push(summary.daySummary(dt, { cached, workouts: db.listWorkouts({ from: dt, to: nextDay(dt) }), meals: db.listMeals({ from: dt, to: nextDay(dt) }), ghNutrition: db.getNutritionDaily(dt) })); return { from, to, ...weekly.weeklySummary(arr, settings) } })
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
  T('list_workouts', 'Logged workouts (sets) in a date range; session_id narrows to the sets attached to one Google Health exercise session.', { ...range, session_id: z.string().optional() }, (a) => db.listWorkouts(a))
  T('log_workout', 'Log a completed exercise set. Pass session_id (from list_exercise_sessions) to attach it to the Google Health session it was part of — Google records no sets/reps/exercise names, this is the only place they live.',
    { name: z.string(), sets: z.number().optional(), reps: z.number().optional(), weight_kg: z.number().optional(), duration_min: z.number().optional(), exercise_id: z.string().optional(), plan_id: z.number().optional(), session_id: z.string().optional(), notes: z.string().optional(), performed_at: z.string().optional() },
    (a) => db.createWorkout({ ...a, performed_at: a.performed_at || localNow() }))
  T('update_workout', 'Update fields of a logged workout by id. Pass session_id to attach/reattach it to a Google Health exercise session (e.g. once list_exercise_sessions reveals the id after the set was logged), or null to detach it.',
    { id: z.number(), name: z.string().optional(), sets: z.number().optional(), reps: z.number().optional(), weight_kg: z.number().optional(), duration_min: z.number().optional(), notes: z.string().optional(), session_id: z.string().nullable().optional() },
    ({ id, ...p }) => db.updateWorkout(id, p))
  T('delete_workout', 'Delete a logged workout by id.', { id: z.number() }, ({ id }) => db.deleteWorkout(id))
  T('get_progress', 'Per-exercise strength progress (max weight / est. 1RM over time).', {}, () => progress.computeProgress(db.listWorkouts({})))

  // ===== Google Health exercise sessions (cached in gh_exercise_sessions; sets/reps linked from `workouts`) =====
  T('list_exercise_sessions', 'Exercise sessions recorded by Google Health (watch/phone) in [from,to), default last 14 days: type, name, times, active minutes, calories, distance, steps, avg HR, HR-zone minutes, pauses. Strength sessions arrive as exercise_type WORKOUT with name = muscle group ("Back", "Chest", "Leg", "Arms", "Shoulders"); Google records NO sets, reps, weights or exercise names — those are the `logged_sets` you log with log_workout passing the session_id. Past days come from the local cache; today (or refresh=true) is fetched live.',
    { ...range, refresh: z.boolean().describe('force a live refetch of the whole range').optional() },
    async ({ from, to, refresh }) => {
      const f = from || shift(today(), -14), t = to || nextDay(today())
      const sessions = (await sessionsFor(f, t, Boolean(refresh))).map((s) => withSets(fmtSession(s)))
      return { range: { from: f, to: t }, count: sessions.length, sessions }
    })
  T('get_exercise_session', 'Full detail of one cached Google Health exercise session: everything in list_exercise_sessions plus events (START/STOP/PAUSE/RESUME…), laps (splitSummaries), splits, notes, source {platform, recording_method}, raw (the Google Exercise object) and its logged_sets. Not found → run list_exercise_sessions for its date first.',
    { session_id: z.string() },
    async ({ session_id }) => {
      let s = db.getExerciseSession(session_id)
      if (!s) throw new Error(`session not found in cache: ${session_id}. Run list_exercise_sessions for its date to fetch it.`)
      // reconcile (what fills the cache) omits dataSource; dataPoints.get has it → fetch once, persist, never again.
      if (!s.source && googleHealth.fetchExerciseSession) {
        try { s = { ...s, ...(await googleHealth.fetchExerciseSession(session_id)) }; db.cacheExerciseSessions([s]) } catch { /* ponytail: offline/expired token → cached detail with source null still beats an error */ }
      }
      return withSets(s)
    })
  T('sync_exercise_sessions', 'Fetch Google Health exercise sessions for [from,to) (default last 30 days) into the local cache. Use to backfill history; list_exercise_sessions refreshes today by itself.',
    range,
    async ({ from, to }) => {
      const f = from || shift(today(), -30), t = to || nextDay(today())
      // Chunk in 30-day windows and cache each as it lands: exercise pages at 25/session and the
      // reconcile call throws (with nothing cached) past 100 pages — an unbounded span could burn
      // that whole budget and write zero rows. A window this size stays well under it, and a bad
      // window still leaves every earlier window's sessions cached.
      let fetched = 0, upserted = 0
      for (let a = f; a < t; a = shift(a, 30)) {
        const b = shift(a, 30) < t ? shift(a, 30) : t
        const { sessions } = await googleHealth.fetchExerciseSessions(a, b)
        fetched += sessions.length
        upserted += db.cacheExerciseSessions(sessions).upserted
      }
      return { range: { from: f, to: t }, fetched, upserted, cache: db.exerciseCacheStats() }
    })
  T('export_exercise_tcx', 'Download a Google Health exercise session as a TCX XML file (GPS track + laps + HR samples). Only meaningful when the session has_gps; indoor WORKOUT sessions yield a near-empty file. Check `bytes`/`trackpoints` before consuming `tcx` — a 1Hz-logged hour can be ~1MB of XML.',
    { session_id: z.string() },
    async ({ session_id }) => {
      const tcx = await googleHealth.exportExerciseTcx(session_id)
      // ponytail: byte/trackpoint counts let the caller decide whether to consume `tcx` at all;
      // no truncation here since cutting the XML mid-document would make it unparseable.
      return { session_id, bytes: Buffer.byteLength(tcx), trackpoints: (tcx.match(/<Trackpoint>/g) || []).length, tcx }
    })
  T('get_workout_day', '"What did I train on a date": Google Health exercise sessions (compact) each with the sets logged against it, `unattached_sets` (sets logged that day with no session_id), and totals (sessions, active minutes, calories). Defaults to today.',
    onDate,
    async ({ date }) => {
      const dt = date || today()
      // Sets attach to a session by session_id, not by the day they were logged — a set entered
      // the next morning still belongs to last night's session. So join via withSets (id-based,
      // same as list_exercise_sessions) rather than filtering that day's workouts by date.
      const ws = db.listWorkouts({ from: dt, to: nextDay(dt) })
      const raw = await sessionsFor(dt, nextDay(dt), false)
      const sessions = raw.map((s) => withSets(fmtSession(s)))
      const unattached_sets = ws.filter((w) => !w.session_id).map(fmtSet)
      const totals = { sessions: sessions.length, active_min: r1(sessions.reduce((a, s) => a + (s.active_min || 0), 0)), calories_kcal: r0(sessions.reduce((a, s) => a + (s.calories_kcal || 0), 0)) }
      return { date: dt, sessions, unattached_sets, totals }
    })
  // Generic escape hatch over every v4 data type. DATA_TYPES comes from the service via googlehealth.cjs;
  // fall back to a free string so the tool still registers against an older service build.
  const DT = googleHealth.DATA_TYPES || null
  const writeOnly = DT ? Object.keys(DT).filter((k) => DT[k].writeOnly) : []
  T('query_google_health', `Raw Google Health v4 data points for any data type over [from,to) (default last 7 days; catalog types like food ignore dates). Returns { data_type, kind, count, truncated, data_points } untranslated — use the specific tools first, this for anything they don't cover. Kinds: sample/interval/session/daily/catalog. Write-only types cannot be read: ${writeOnly.join(', ') || 'symptoms, moods, menstrual-period, ovulation-test'}.`,
    { data_type: DT ? z.enum(Object.keys(DT)) : z.string(), ...range, max_pages: z.number().int().min(1).max(100).describe('page cap; truncated=true when hit').optional() },
    ({ data_type, from, to, max_pages }) => {
      if (DT?.[data_type]?.writeOnly) throw new Error(`${data_type} is write-only in Google Health (create/update/batchDelete only); it cannot be read.`)
      return googleHealth.queryDataPoints(data_type, from || shift(today(), -7), to || nextDay(today()), { maxPages: max_pages })
    })

  // ===== Google Health writes (nutrition-log, hydration-log, weight — the *.writeonly scopes) =====
  // Live-tested facts callers must know (see WRITE-SPEC.md fact 3): Google does NOT deduplicate —
  // every log_*_to_google_health call creates a brand-new entry, even with identical content
  // back-to-back, so never call one twice for the same thing. And a client can't choose the created
  // id — Google always assigns its own; the `name` a call returns is the only handle you get, keep
  // it if you might need delete_google_health_entry. (Session-interval synthesis for nutrition/
  // hydration is handled inside the write path itself — nothing callers need to think about.)
  T('log_meal_to_google_health', 'Writes a food entry to your REAL Google Health / Fitbit account — NOT the local `meals` table (use log_meal for that). Google does not deduplicate: calling this twice for the same meal logs it twice, and an error/timeout here may still mean the write landed server-side — check with query_google_health before retrying rather than assuming it failed. Undo with delete_google_health_entry({ name }) using the returned name.',
    {
      at: z.string().describe('ISO datetime; default now').optional(),
      food_name: z.string(), meal_type: z.string(), calories: z.number(), carbs_g: z.number(), fat_g: z.number(),
      protein_g: z.number().optional(), fiber_g: z.number().optional(), sugar_g: z.number().optional(),
      sodium_mg: z.number().optional(), saturated_fat_g: z.number().optional(), cholesterol_mg: z.number().optional(),
      serving_amount: z.number().optional(), serving_unit: z.string().optional(),
    },
    async (a) => {
      const at = a.at || localNow()
      const { name } = await googleHealth.writeMeal({
        startTime: at, foodDisplayName: a.food_name, mealType: a.meal_type,
        servingAmount: a.serving_amount, servingUnit: a.serving_unit,
        calories: a.calories, carbsG: a.carbs_g, fatG: a.fat_g, proteinG: a.protein_g,
        fiberG: a.fiber_g, sugarG: a.sugar_g, sodiumMg: a.sodium_mg,
        saturatedFatG: a.saturated_fat_g, cholesterolMg: a.cholesterol_mg,
      })
      return { name, logged: { at, food_name: a.food_name, meal_type: a.meal_type, calories: a.calories, carbs_g: a.carbs_g, fat_g: a.fat_g } }
    })
  T('log_water_to_google_health', 'Writes a hydration entry to your REAL Google Health / Fitbit account — NOT the local hydration log (use log_hydration for that). Google does not deduplicate: calling this twice logs water twice, and an error/timeout here may still mean the write landed server-side — check with query_google_health before retrying rather than assuming it failed. Undo with delete_google_health_entry({ name }) using the returned name.',
    { at: z.string().describe('ISO datetime; default now').optional(), milliliters: z.number() },
    async ({ at, milliliters }) => {
      const t = at || localNow()
      const { name } = await googleHealth.writeHydration({ startTime: t, milliliters })
      return { name, logged: { at: t, milliliters } }
    })
  T('log_weight_to_google_health', 'Writes a body-weight entry to your REAL Google Health / Fitbit account — NOT the local body-metrics table (use upsert_body_metric for that). Converts weight_kg to grams for the API. Google does not deduplicate: calling this twice logs weight twice, and an error/timeout here may still mean the write landed server-side — check with query_google_health before retrying rather than assuming it failed. Undo with delete_google_health_entry({ name }) using the returned name.',
    { at: z.string().describe('ISO datetime; default now').optional(), weight_kg: z.number(), notes: z.string().optional() },
    async ({ at, weight_kg, notes }) => {
      const t = at || localNow()
      const { name } = await googleHealth.writeWeight({ physicalTime: t, weightGrams: Math.round(weight_kg * 1000), notes })
      return { name, logged: { at: t, weight_kg, notes: notes ?? null } }
    })
  T('log_workout_to_google_health', 'Log a strength/gym workout to your REAL Google Health / Fitbit account AND to this server\'s local workouts table in one call. IMPORTANT: Google Health has no fields for sets, reps, weights or exercise names — none exist in the API — so the exercise list is rendered into the session\'s free-text notes (e.g. "Bench press 3x8 @40kg"), which is the only place the app will show it. The structured sets are stored locally, which is what get_progress uses for 1RM tracking. The session TITLE in the app comes from exercise_type and cannot be set by name (STRENGTH_TRAINING shows as "Strength training"). Google does not deduplicate: calling this twice logs two sessions. Undo the Google side with delete_google_health_entry({ name }).',
    {
      start: z.string().describe('ISO datetime the workout started'),
      end: z.string().describe('ISO datetime it ended').optional(),
      duration_min: z.number().describe('used to derive `end` when end is omitted').optional(),
      exercise_type: z.string().describe('Google exerciseType, e.g. STRENGTH_TRAINING (default), WEIGHTLIFTING, FREE_WEIGHTS, CIRCUIT_TRAINING, CORE_TRAINING, CALISTHENICS, CROSSFIT, PILATES, WORKOUT').optional(),
      exercises: z.array(z.object({
        name: z.string(), sets: z.number().optional(), reps: z.number().optional(),
        weight_kg: z.number().optional(), duration_min: z.number().optional(), exercise_id: z.string().optional(), notes: z.string().optional(),
      })).describe('the actual lifts; each is also written to the local workouts table'),
      notes: z.string().describe('free-text appended after the exercise lines').optional(),
      calories_kcal: z.number().optional(),
      avg_hr_bpm: z.number().optional(),
      also_log_locally: z.boolean().describe('default true; set false to write only to Google').optional(),
    },
    async ({ start, end, duration_min, exercise_type, exercises, notes, calories_kcal, avg_hr_bpm, also_log_locally }) => {
      const endTime = end || (duration_min != null ? new Date(new Date(start).getTime() + duration_min * 60_000).toISOString() : undefined)
      const { name } = await googleHealth.writeExercise({
        startTime: start, endTime, exerciseType: exercise_type || 'STRENGTH_TRAINING',
        exercises, notes, caloriesKcal: calories_kcal, avgHeartRateBpm: avg_hr_bpm,
        activeDurationS: duration_min != null ? duration_min * 60 : undefined,
      })
      // Local rows carry session_id so list_exercise_sessions/get_workout_day show the sets
      // under the very session we just created in Google.
      const logged = (also_log_locally === false ? [] : exercises).map((e) => db.createWorkout({
        name: e.name, exercise_id: e.exercise_id ?? null, sets: e.sets ?? null, reps: e.reps ?? null,
        weight_kg: e.weight_kg ?? null, duration_min: e.duration_min ?? null, notes: e.notes ?? null,
        performed_at: start, session_id: name,
      }))
      return { name, exercise_type: exercise_type || 'STRENGTH_TRAINING', exercises_logged_locally: logged.length,
        note: 'Sets/reps appear in the Google Health app inside the session notes — the API has no structured field for them.' }
    })

  T('delete_google_health_entry', 'Delete an entry previously written by log_meal_to_google_health / log_water_to_google_health / log_weight_to_google_health. `name` is the value that call returned. Only works on entries this server wrote; one logged in the Fitbit app returns a permission error and must be deleted in that app.',
    { name: z.string() }, ({ name }) => googleHealth.deleteGoogleHealthEntry(name))
  T('update_google_health_entry', 'Edit a food entry already in Google Health (get its `name` from get_food_log / get_nutrition_intake as google_health_name) that has no row in the local meals table — including anything logged with log_meal_to_google_health, which writes to Google only. If the meal came from log_meal it HAS a local row: use update_meal with its id instead, so both sides stay in sync. Google Health has no working update for food entries, so this deletes the old entry and writes a new one — the entry gets a NEW `name`, returned as `name`, with the old one as `old_name`. Only works on entries this server logged; Google refuses to let one app modify another app\'s data, so an entry logged in the Fitbit app must be edited in the Fitbit app.',
    {
      name: z.string(), food_name: z.string().optional(), meal_type: z.string().optional(),
      calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(),
      fat_g: z.number().optional(), fiber_g: z.number().optional(), sugar_g: z.number().optional(),
      sodium_mg: z.number().optional(), eaten_at: z.string().optional(),
    },
    ({ name, food_name, meal_type, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, eaten_at }) =>
      googleHealth.updateGoogleHealthEntry(name, dropNulls({
        foodDisplayName: food_name, mealType: meal_type ? meal_type.toUpperCase() : undefined,
        calories, proteinG: protein_g, carbsG: carbs_g, fatG: fat_g, fiberG: fiber_g, sugarG: sugar_g,
        sodiumMg: sodium_mg, startTime: eaten_at,
      })))

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
  // One place where a local meal row also becomes a real Google Health entry: write the row,
  // mirror it, persist the id Google returns. Callers pass local_only to skip Google.
  // Mirroring-by-default (when local_only is falsy) is deliberate — "log my meal" has meant the
  // phone app both times a human said it here, and a description telling the model to pick a
  // different tool did not survive a client with a cached tool list.
  async function logMealRow({ name, meal_type, calories, protein_g, carbs_g, fat_g, notes, eaten_at }, local_only) {
    const row = db.createMeal({ name, meal_type, calories, protein_g, carbs_g, fat_g, notes, eaten_at })
    if (local_only) return { ...row, google_health_name: null, note: 'local only — not in the Google Health app' }
    try {
      const { name: gName } = await googleHealth.writeMeal({
        startTime: eaten_at, foodDisplayName: name, mealType: (meal_type || 'ANYTIME').toUpperCase(),
        servingAmount: 1, calories: calories ?? 0, carbsG: carbs_g ?? 0, fatG: fat_g ?? 0, proteinG: protein_g,
      })
      // Persisted so update_meal/delete_meal can reach the Google entry later.
      return db.updateMeal(row.id, { google_health_name: gName })
    } catch (e) {
      // The local row is already saved; say plainly that only half of it landed.
      return { ...row, google_health_name: null, google_health_error: String(e.message || e).slice(0, 200) }
    }
  }
  T('list_meals', 'Logged meals in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listMeals({ from, to }))
  T('log_meal', 'Log a meal. Writes to the REAL Google Health / Fitbit app AND this server\'s local database, so it shows up where the user actually looks. Pass local_only:true to skip Google. Google does not deduplicate, so do not call twice for the same meal; undo the Google side with delete_google_health_entry using the returned google_health_name.',
    { name: z.string(), meal_type: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(), eaten_at: z.string().optional(), local_only: z.boolean().optional() },
    async ({ local_only, ...a }) => logMealRow({ ...a, eaten_at: a.eaten_at || localNow() }, local_only))
  T('update_meal', 'Update a logged meal by id. If it was also written to Google Health, replaces that entry with the updated values too (Google Health has no working update — this deletes the old entry and writes a new one, so google_health_name changes). Pass local_only:true to skip Google.',
    { id: z.number(), name: z.string().optional(), meal_type: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(), local_only: z.boolean().optional() },
    async ({ id, local_only, ...p }) => {
      const row = db.updateMeal(id, p)
      if (!row.google_health_name) return { ...row, google_health: 'not linked — this meal was never written to Google Health' }
      if (local_only) return row
      try {
        const { name, warning } = await googleHealth.updateGoogleHealthEntry(row.google_health_name, {
          startTime: row.eaten_at, foodDisplayName: row.name, mealType: (row.meal_type || 'ANYTIME').toUpperCase(),
          servingAmount: 1, calories: row.calories ?? 0, carbsG: row.carbs_g ?? 0, fatG: row.fat_g ?? 0, proteinG: row.protein_g,
        })
        // Replace, not patch — Google issues a NEW data point id, so the row must track it to stay addressable.
        // `warning` means the new entry landed but the old one is still in the app: say so, don't call it clean.
        return { ...db.updateMeal(id, { google_health_name: name }), ...(warning ? { google_health_warning: warning } : {}) }
      } catch (e) {
        return { ...row, google_health_error: String(e.message || e).slice(0, 300) }
      }
    })
  T('delete_meal', 'Delete a logged meal by id. If it was also written to Google Health, deletes that entry too (unless local_only) and reports both sides.',
    { id: z.number(), local_only: z.boolean().optional() },
    async ({ id, local_only }) => {
      const row = db.updateMeal(id, {})
      if (!row?.google_health_name || local_only) return db.deleteMeal(id)
      try {
        const { deleted } = await googleHealth.deleteGoogleHealthEntry(row.google_health_name)
        return { ...db.deleteMeal(id), google_health_deleted: deleted }
      } catch (e) {
        // Keep the local row: it holds the only copy of google_health_name, so deleting it here
        // would strand the Google Health entry with no way left to address it.
        return { deleted: false, google_health_name: row.google_health_name, google_health_error: String(e.message || e).slice(0, 300),
          note: 'Local row kept so the Google Health entry can still be found — retry, or pass local_only:true to drop just the local row.' }
      }
    })
  // duplicate_meals writes one real Google Health entry per copied meal (unless local_only), so
  // every copy gets its own google_health_name — a bulk local insert would leave the copies
  // unreachable by update_meal/delete_meal, the exact bug class the 2026-09-04 fix closed.
  T('duplicate_meals', 'Copy all meals from one date to another (e.g. repeat yesterday). Writes one real entry per copied meal to the Google Health / Fitbit app by default — Google does not deduplicate, so do not call this twice for the same pair of dates. Pass local_only:true to copy locally only.',
    { from_date: z.string().describe('YYYY-MM-DD'), to_date: z.string().describe('YYYY-MM-DD'), local_only: z.boolean().optional() },
    async ({ from_date, to_date, local_only }) => {
      const source = db.listMeals({ from: from_date, to: nextDay(from_date) })
      const copies = []
      // to_date + the original's time-of-day, same shifting db.duplicateMeals used to do itself.
      for (const r of source) copies.push(await logMealRow({
        name: r.name, meal_type: r.meal_type, calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, notes: r.notes,
        eaten_at: to_date + r.eaten_at.slice(10),
      }, local_only))
      return { copied: copies, google_health_count: copies.filter((c) => c.google_health_name).length }
    })
  T('search_food', 'Search foods for nutrition facts (calories + macros per serving).', { query: z.string() }, ({ query }) => food.searchFood(query))
  T('lookup_barcode', 'Look up a packaged food by barcode for nutrition facts.', { code: z.string() }, ({ code }) => food.lookupBarcode(code))
  T('list_meal_recipes', 'Saved meal templates/recipes.', {}, () => db.listMealRecipes())
  // batch_calories/batch_protein_g/batch_carbs_g/batch_fat_g let a recipe be entered as a whole
  // prep-batch total instead of per serving; `servings` (just passed, or already on the row) is
  // the divisor. No guessing: missing divisor or a plain+batch pair for the same macro is an error.
  const BATCH_MACROS = { calories: 'batch_calories', protein_g: 'batch_protein_g', carbs_g: 'batch_carbs_g', fat_g: 'batch_fat_g' }
  function resolveRecipeMacros(input, existingServings) {
    const { servings, ...rest } = input
    const divisor = servings ?? existingServings
    const out = { ...rest }
    if (servings !== undefined) out.servings = servings
    for (const [plain, batchKey] of Object.entries(BATCH_MACROS)) {
      const batchVal = input[batchKey]
      delete out[batchKey]
      if (batchVal === undefined) continue
      if (input[plain] !== undefined) throw new Error(`Pass either ${plain} or ${batchKey}, not both`)
      if (!(divisor > 0)) throw new Error(`${batchKey} needs servings — pass servings (how many servings this batch makes) so it can be divided down`)
      out[plain] = batchVal / divisor
    }
    return out
  }
  T('create_meal_recipe', 'Save a reusable meal template with its macros, stored PER SERVING. Pass servings plus batch_calories/batch_protein_g/batch_carbs_g/batch_fat_g instead of the plain macro fields to record a whole prep batch — it is divided down to per-serving before saving.',
    { name: z.string(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(),
      servings: z.number().positive().optional(), batch_calories: z.number().optional(), batch_protein_g: z.number().optional(), batch_carbs_g: z.number().optional(), batch_fat_g: z.number().optional() },
    (a) => db.createMealRecipe(resolveRecipeMacros(a)))
  T('update_meal_recipe', 'Update a meal template by id. Stored macros are always per serving; pass servings plus batch_calories/batch_protein_g/batch_carbs_g/batch_fat_g to give a batch total (needs servings — just passed, or already on the row) and it is divided down to per-serving.',
    { id: z.number(), name: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(),
      servings: z.number().positive().optional(), batch_calories: z.number().optional(), batch_protein_g: z.number().optional(), batch_carbs_g: z.number().optional(), batch_fat_g: z.number().optional() },
    ({ id, ...p }) => db.updateMealRecipe(id, resolveRecipeMacros(p, db.listMealRecipes().find((r) => r.id === id)?.servings)))
  T('delete_meal_recipe', 'Delete a meal template by id.', { id: z.number() }, ({ id }) => db.deleteMealRecipe(id))
  // id first (numbers get stringified by the client, so compare as strings), then a case-insensitive
  // name match — errors list close-name matches rather than a bare "not found".
  function findRecipe(recipe) {
    const recipes = db.listMealRecipes()
    const byId = recipes.find((r) => String(r.id) === recipe)
    if (byId) return byId
    const lower = recipe.toLowerCase()
    const byName = recipes.find((r) => r.name.toLowerCase() === lower)
    if (byName) return byName
    const near = recipes.filter((r) => r.name.toLowerCase().includes(lower)).map((r) => r.name)
    throw new Error(near.length
      ? `No recipe named "${recipe}" — did you mean: ${near.join(', ')}?`
      : `No recipe named "${recipe}". Saved recipes: ${recipes.map((r) => r.name).join(', ') || 'none yet'}`)
  }
  T('log_meal_recipe', 'Logs a saved prep recipe as a meal, into the REAL Google Health / Fitbit app AND the local database. Macros are per serving and scaled by `servings`. Google does not deduplicate, so do not call this twice for the same box. Pass local_only:true to skip Google.',
    { recipe: z.string().describe('Recipe name or id'), servings: z.number().positive().optional().describe('How many servings eaten now, default 1'), meal_type: z.string().optional(), eaten_at: z.string().optional(), notes: z.string().optional(), local_only: z.boolean().optional() },
    async ({ recipe, servings, meal_type, eaten_at, notes, local_only }) => {
      const r = findRecipe(recipe)
      const n = servings ?? 1
      const scale = (v) => (v == null ? null : v * n)
      const row = await logMealRow({
        name: n === 1 ? r.name : `${r.name} x${n}`, meal_type,
        calories: scale(r.calories), protein_g: scale(r.protein_g), carbs_g: scale(r.carbs_g), fat_g: scale(r.fat_g),
        notes: notes || r.notes, eaten_at: eaten_at || localNow(),
      }, local_only)
      return { ...row, recipe: r.name, recipe_id: r.id, servings: n }
    })

  // ===== Hydration (local hydration log; Google Health water is read-only) =====
  T('log_hydration', 'Log water. Writes to the REAL Google Health / Fitbit app AND this server\'s local database. Pass local_only:true to skip Google. Google does not deduplicate, so do not call twice for the same drink; undo the Google side with delete_google_health_entry using the returned google_health_name.',
    { ml: z.number(), at: z.string().describe('ISO datetime; default now').optional(), notes: z.string().optional(), local_only: z.boolean().optional() },
    async ({ local_only, ...a }) => {
      const at = a.at || localNow()
      if (local_only) return { ...db.createHydration({ ...a, at }), google_health_name: null, note: 'local only — not in the Google Health app' }
      // Google write happens before the local insert so a successful name can go straight into
      // the row (no updateHydration exists to patch it in after the fact).
      try {
        const { name } = await googleHealth.writeHydration({ startTime: at, milliliters: a.ml })
        return db.createHydration({ ...a, at, google_health_name: name })
      } catch (e) {
        return { ...db.createHydration({ ...a, at }), google_health_name: null, google_health_error: String(e.message || e).slice(0, 200) }
      }
    })
  T('list_hydration', 'Your logged water intake in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listHydration({ from, to }))
  T('delete_hydration', 'Delete a hydration log entry by id. If it was also written to Google Health, deletes that entry too (unless local_only) and reports both sides.',
    { id: z.number(), local_only: z.boolean().optional() },
    async ({ id, local_only }) => {
      const row = db.listHydration({}).find((h) => h.id === id)
      if (!row?.google_health_name || local_only) return db.deleteHydration(id)
      try {
        const { deleted } = await googleHealth.deleteGoogleHealthEntry(row.google_health_name)
        return { ...db.deleteHydration(id), google_health_deleted: deleted }
      } catch (e) {
        // Same reason as delete_meal: the row is the only place the Google entry's id is stored.
        return { deleted: false, google_health_name: row.google_health_name, google_health_error: String(e.message || e).slice(0, 300),
          note: 'Local row kept so the Google Health entry can still be found — retry, or pass local_only:true to drop just the local row.' }
      }
    })

  // ===== Body =====
  T('list_body_metrics', 'Body measurements (weight, body fat, waist, chest, arm) in a date range.', { from: z.string().optional(), to: z.string().optional() }, ({ from, to }) => db.listBodyMetrics({ from, to }))
  T('upsert_body_metric', 'Record/update body measurements (weight, body fat, waist, chest, arm) in this server\'s LOCAL database only — NOT written to the Google Health / Fitbit app. For weight the user wants in their actual health app, use log_weight_to_google_health instead. This tool is still the right one for measurements Google Health has no field for (waist/chest/arm).',
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
    // Accept the token via Authorization/x-api-key header, OR ?token= in the URL.
    // The URL fallback is for chat-app connector dialogs that only offer OAuth/no-auth
    // and have no header field (e.g. claude.ai "Add custom connector").
    const urlToken = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') || ''
    const provided = authz.startsWith('Bearer ') ? authz.slice(7) : (req.headers['x-api-key'] || urlToken)
    if (!token || !tokenEqual(provided, token)) {
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
