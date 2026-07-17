// Consied MCP server — exposes the single-user health data as MCP tools over
// Streamable HTTP at /mcp. Bearer-token gated (only the token holder = you).
// Deps (db, openfit, summary, weekly, progress) are injected by index.cjs so this
// module stays SDK-only. Stateless: one server+transport per request.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const isoDay = (d) => d.toISOString().slice(0, 10)
const today = () => isoDay(new Date())
const shift = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d) }
const nextDay = (dateStr) => shift(dateStr, 1)

const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: 'Error: ' + (e?.message || e) }], isError: true })
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})) } catch (e) { return fail(e) } }

function buildServer({ db, openfit, summary, weekly, progress }) {
  const server = new McpServer({ name: 'consied-health', version: '1.0.0' })
  const health = () => openfit.getHealth().then((h) => h?.data ?? null).catch(() => null)

  // ---- reads ----
  server.tool('get_status', 'App + Google-Health sync status.', {}, wrap(async () => ({ app: 'consied', openfit: await openfit.getStatus() })))
  server.tool('get_health', 'Raw cached Google Health metrics (steps, heart, sleep, etc.).', {}, wrap(() => openfit.getHealth()))
  server.tool('get_daily_summary', 'Full day summary: health, workouts, meals, nutrition, calorie balance.',
    { date: z.string().describe('YYYY-MM-DD; defaults to today').optional() },
    wrap(async ({ date }) => {
      const d = date || today()
      return summary.daySummary(d, { cached: await health(), workouts: db.listWorkouts({ from: d, to: nextDay(d) }), meals: db.listMeals({ from: d, to: nextDay(d) }) })
    }))
  server.tool('get_weekly_summary', 'Rolling multi-day summary with averages, insights, best/worst day.',
    { days: z.number().int().min(1).max(31).describe('trailing days, default 7').optional() },
    wrap(async ({ days }) => {
      const n = days || 7, to = today(), from = shift(to, -(n - 1)), cached = await health(), settings = db.getSettings(), arr = []
      for (let d = from; d <= to; d = nextDay(d)) arr.push(summary.daySummary(d, { cached, workouts: db.listWorkouts({ from: d, to: nextDay(d) }), meals: db.listMeals({ from: d, to: nextDay(d) }) }))
      return { from, to, ...weekly.weeklySummary(arr, settings) }
    }))
  server.tool('list_workouts', 'Logged workouts in a date range.',
    { from: z.string().optional(), to: z.string().optional() },
    wrap(({ from, to }) => db.listWorkouts({ from, to })))
  server.tool('list_workout_plans', 'Saved workout plans/routines with their exercises.', {}, wrap(() => db.listWorkoutPlans()))
  server.tool('list_meals', 'Logged meals in a date range.',
    { from: z.string().optional(), to: z.string().optional() },
    wrap(({ from, to }) => db.listMeals({ from, to })))
  server.tool('list_habits', 'Habit definitions with done/not-done for a date.',
    { date: z.string().describe('YYYY-MM-DD; defaults to today').optional() },
    wrap(({ date }) => db.listHabits(date || today())))
  server.tool('list_body_metrics', 'Body measurements (weight, body fat, waist, etc.) in a date range.',
    { from: z.string().optional(), to: z.string().optional() },
    wrap(({ from, to }) => db.listBodyMetrics({ from, to })))
  server.tool('get_progress', 'Per-exercise strength progress (max weight / est. 1RM over time).', {}, wrap(() => progress.computeProgress(db.listWorkouts({}))))
  server.tool('get_settings', 'Goals: calories, protein, steps, sleep, target weight, height.', {}, wrap(() => db.getSettings()))

  // ---- writes ----
  server.tool('log_workout', 'Log a completed exercise set.',
    { name: z.string(), sets: z.number().optional(), reps: z.number().optional(), weight_kg: z.number().optional(), duration_min: z.number().optional(), exercise_id: z.string().optional(), notes: z.string().optional(), performed_at: z.string().describe('ISO datetime; defaults to now').optional() },
    wrap((a) => db.createWorkout({ ...a, performed_at: a.performed_at || new Date().toISOString() })))
  server.tool('log_meal', 'Log a meal with nutrition.',
    { name: z.string(), meal_type: z.string().optional(), calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(), fat_g: z.number().optional(), notes: z.string().optional(), eaten_at: z.string().describe('ISO datetime; defaults to now').optional() },
    wrap((a) => db.createMeal({ ...a, eaten_at: a.eaten_at || new Date().toISOString() })))
  server.tool('set_habit', 'Mark a habit done/undone for a date.',
    { habit: z.string(), done: z.boolean(), date: z.string().describe('YYYY-MM-DD; defaults to today').optional() },
    wrap(({ habit, done, date }) => { db.setHabit(date || today(), habit, done); return { habit, done, date: date || today() } }))
  server.tool('upsert_body_metric', 'Record/update body measurements for a date.',
    { date: z.string().optional(), weight_kg: z.number().optional(), body_fat_pct: z.number().optional(), waist_cm: z.number().optional(), chest_cm: z.number().optional(), arm_cm: z.number().optional(), notes: z.string().optional() },
    wrap(({ date, ...patch }) => db.upsertBodyMetric(date || today(), patch)))
  server.tool('sync_google_health', 'Pull the latest Google Health data into consied.', {}, wrap(() => openfit.sync()))

  return server
}

export function createMcpHandler(deps) {
  const token = deps.token
  return async function handleMcp(req, res, bodyRaw) {
    const authz = req.headers['authorization'] || ''
    const provided = authz.startsWith('Bearer ') ? authz.slice(7) : (req.headers['x-api-key'] || '')
    if (!token || provided !== token) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="consied-mcp"' })
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
