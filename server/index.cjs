const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { sendJson, readBody } = require('./http-helpers.cjs')
const db = require('./db.cjs')
const exercises = require('./exercises.cjs')
const openfit = require('./openfit.cjs')
const summary = require('./summary.cjs')
const auth = require('./auth.cjs')
const progress = require('./progress.cjs')
const weekly = require('./weekly.cjs')
const recommend = require('./recommend.cjs')
const reminderEngine = require('./reminders.cjs')
const food = require('./food.cjs')
const crypto = require('node:crypto')

// MCP bearer token: env override, else generated once and persisted beside the DB.
function resolveMcpToken(dataDir) {
  if (process.env.CONSIED_MCP_TOKEN) return process.env.CONSIED_MCP_TOKEN
  if (!dataDir) return crypto.randomBytes(32).toString('hex')
  const file = path.join(dataDir, 'mcp-token.txt')
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t } catch {}
  const t = crypto.randomBytes(32).toString('hex')
  try { fs.writeFileSync(file, t + '\n', { mode: 0o600 }) } catch {}
  return t
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

function serveStatic(res, distDir, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname
  let file = path.join(distDir, rel)
  if (!file.startsWith(distDir)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not built') }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

function shiftDate(date, delta) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
const nextDay = (date) => shiftDate(date, 1)
const todayISO = () => new Date().toISOString().slice(0, 10)

function weightSeriesFrom(cached) {
  const arr = (cached && cached.endpoints && cached.endpoints.bodyWeight && cached.endpoints.bodyWeight.weight) || []
  const byDate = {}
  for (const r of arr) { const d = r.dateTime || r.date; if (d && r.weight != null) byDate[d] = r.weight }
  return Object.keys(byDate).sort().map((date) => ({ date, value: byDate[date] }))
}

function toCsv(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

function createServer({ dbFile, exercisesJson, distDir }) {
  db.initDb(dbFile)
  exercises.loadExercises(exercisesJson)
  auth.init(dbFile === ':memory:' ? null : path.dirname(dbFile))

  const mcpToken = resolveMcpToken(dbFile === ':memory:' ? null : path.dirname(dbFile))
  let mcpHandler = null

  return http.createServer(async (req, res) => {
    try {
      // Cloudflare terminates TLS and forwards the original visitor scheme here.
      // If a user hits the Cloudflare URL over http://, force https:// so browser-only
      // APIs such as camera/getUserMedia run in a secure context.
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
      if (forwardedProto === 'http') {
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1').split(',')[0].trim()
        res.writeHead(308, { location: `https://${host}${req.url || '/'}` })
        return res.end()
      }

      const u = new URL(req.url, 'http://127.0.0.1')
      const p = u.pathname
      const m = req.method
      const q = u.searchParams
      const seg = p.split('/').filter(Boolean)

      // MCP endpoint — bearer-gated, bypasses the browser cookie-auth gate.
      if (p === '/mcp' || p.startsWith('/mcp/')) {
        if (!mcpHandler) {
          const { createMcpHandler } = await import('./mcp.mjs')
          mcpHandler = createMcpHandler({ db, openfit, summary, weekly, progress, recommend, exercises, food, reminders: reminderEngine, token: mcpToken })
        }
        let raw = ''
        if (m === 'POST') { for await (const chunk of req) raw += chunk }
        return mcpHandler(req, res, raw)
      }

      // --- auth: login/logout always reachable; every other /api/* route requires a session ---
      if (p === '/api/login' && m === 'POST') {
        const body = await readBody(req)
        if (!auth.checkPassword(body.password)) return sendJson(res, 401, { ok: false, error: 'invalid password' })
        res.setHeader('Set-Cookie', auth.makeSessionCookie())
        return sendJson(res, 200, { ok: true })
      }
      if (p === '/api/logout' && m === 'POST') {
        res.setHeader('Set-Cookie', auth.clearSessionCookie())
        return sendJson(res, 200, { ok: true })
      }
      if (p.startsWith('/api/') && !auth.authed(req)) return sendJson(res, 401, { error: 'unauthorized' })
      if (p === '/api/me' && m === 'GET') return sendJson(res, 200, { ok: true })

      if (p === '/api/status' && m === 'GET') return sendJson(res, 200, { app: 'consied', openfit: await openfit.getStatus() })
      if (p === '/api/health' && m === 'GET') return sendJson(res, 200, await openfit.getHealth())
      if (p === '/api/sync' && m === 'POST') return sendJson(res, 200, await openfit.sync())

      if (p === '/api/exercises/facets' && m === 'GET') return sendJson(res, 200, exercises.facets())
      if (p === '/api/exercises' && m === 'GET') return sendJson(res, 200, exercises.searchExercises(Object.fromEntries(q)))
      if (seg[0] === 'api' && seg[1] === 'exercises' && seg[2] && m === 'GET') {
        const e = exercises.getExercise(seg[2])
        return e ? sendJson(res, 200, e) : sendJson(res, 404, { error: 'not found' })
      }

      if (p === '/api/workouts' && m === 'GET') return sendJson(res, 200, db.listWorkouts({ from: q.get('from'), to: q.get('to') }))
      if (p === '/api/workouts' && m === 'POST') return sendJson(res, 201, db.createWorkout(await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'workouts' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateWorkout(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'workouts' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteWorkout(Number(seg[2])))

      if (p === '/api/meals' && m === 'GET') {
        return sendJson(res, 200, db.listMeals({
          from: q.get('from'), to: q.get('to'), meal_type: q.get('meal_type') || undefined, limit: q.get('limit') || undefined,
        }))
      }
      if (p === '/api/meals' && m === 'POST') return sendJson(res, 201, db.createMeal(await readBody(req)))
      if (p === '/api/meals/duplicate' && m === 'POST') {
        const body = await readBody(req)
        if (!body.from || !body.to) return sendJson(res, 400, { error: 'from and to dates required' })
        return sendJson(res, 200, db.duplicateMeals(body.from, body.to))
      }
      if (seg[0] === 'api' && seg[1] === 'meals' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateMeal(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'meals' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteMeal(Number(seg[2])))

      if (p === '/api/meal-recipes' && m === 'GET') return sendJson(res, 200, db.listMealRecipes())
      if (p === '/api/meal-recipes' && m === 'POST') return sendJson(res, 201, db.createMealRecipe(await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'meal-recipes' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateMealRecipe(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'meal-recipes' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteMealRecipe(Number(seg[2])))

      if (p === '/api/settings' && m === 'GET') return sendJson(res, 200, db.getSettings())
      if (p === '/api/settings' && m === 'PATCH') return sendJson(res, 200, db.updateSettings(await readBody(req)))

      if (p === '/api/habits' && m === 'GET') return sendJson(res, 200, db.getHabits(q.get('date') || todayISO()))
      if (p === '/api/habits/status' && m === 'GET') return sendJson(res, 200, db.listHabits(q.get('date') || todayISO()))
      if (p === '/api/habits/new' && m === 'POST') {
        const body = await readBody(req)
        if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: 'name required' })
        return sendJson(res, 201, db.createHabit(body.name))
      }
      if (p === '/api/habits' && m === 'POST') {
        const body = await readBody(req)
        if (!body.date || !body.habit) return sendJson(res, 400, { error: 'date and habit required' })
        return sendJson(res, 200, db.setHabit(body.date, body.habit, Boolean(body.done)))
      }
      if (seg[0] === 'api' && seg[1] === 'habits' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteHabit(decodeURIComponent(seg[2])))

      if (p === '/api/body' && m === 'GET') return sendJson(res, 200, db.listBodyMetrics({ from: q.get('from'), to: q.get('to') }))
      if (p === '/api/body' && m === 'POST') {
        const body = await readBody(req)
        if (!body.date) return sendJson(res, 400, { error: 'date required' })
        return sendJson(res, 200, db.upsertBodyMetric(body.date, body))
      }
      if (seg[0] === 'api' && seg[1] === 'body' && seg[2] === 'photo' && seg[3] && m === 'GET') {
        const filePath = db.photoPath(seg[3])
        if (!filePath) return sendJson(res, 404, { error: 'not found' })
        const ext = path.extname(filePath).slice(1)
        res.writeHead(200, { 'content-type': 'image/' + (ext === 'jpg' ? 'jpeg' : ext) })
        return fs.createReadStream(filePath).pipe(res)
      }
      if (seg[0] === 'api' && seg[1] === 'body' && seg[2] === 'photo' && m === 'POST') {
        const body = await readBody(req)
        if (!body.date || !body.dataUrl) return sendJson(res, 400, { error: 'date and dataUrl required' })
        try {
          const ref = db.savePhoto(body.dataUrl)
          return sendJson(res, 200, db.upsertBodyMetric(body.date, { photo_ref: ref }))
        } catch (e) { return sendJson(res, 400, { error: e.message }) }
      }
      if (seg[0] === 'api' && seg[1] === 'body' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteBodyMetric(Number(seg[2])))

      if (p === '/api/workout-plans' && m === 'GET') return sendJson(res, 200, db.listWorkoutPlans())
      if (p === '/api/workout-plans' && m === 'POST') return sendJson(res, 201, db.createWorkoutPlan(await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'workout-plans' && seg[2] && seg[3] === 'compare' && m === 'GET') {
        const plan = db.getWorkoutPlan(Number(seg[2]))
        if (!plan) return sendJson(res, 404, { error: 'not found' })
        const date = q.get('date') || todayISO()
        const logged = db.listWorkouts({ from: date, to: nextDay(date) }).filter((w) => w.plan_id === plan.id)
        return sendJson(res, 200, { plan, date, planned: plan.items, logged })
      }
      if (seg[0] === 'api' && seg[1] === 'workout-plans' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateWorkoutPlan(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'workout-plans' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteWorkoutPlan(Number(seg[2])))

      if (p === '/api/progress' && m === 'GET') return sendJson(res, 200, progress.computeProgress(db.listWorkouts({})))

      if (p === '/api/recommendation' && m === 'GET') {
        const settings = db.getSettings()
        const health = await openfit.getHealth()
        const cached = health.data
        const weightSeries = weightSeriesFrom(cached)
        const today = todayISO()
        const meals14 = db.listMeals({ from: shiftDate(today, -13), to: nextDay(today) })
        const avgCaloriesIn = summary.nutritionTotals(meals14).calIn / 14
        let outSum = 0, outCount = 0
        for (let i = 0; i < 14; i++) {
          const h = summary.extractHealthMetrics(cached, shiftDate(today, -i))
          if (h.caloriesOut != null) { outSum += h.caloriesOut; outCount++ }
        }
        const currentWeightKg = weightSeries.length ? weightSeries[weightSeries.length - 1].value : summary.extractHealthMetrics(cached, today).weightKg
        return sendJson(res, 200, recommend.recommend({
          weightSeries, avgCaloriesIn, avgCaloriesOut: outCount ? outSum / outCount : null,
          currentWeightKg, goalWeightKg: settings.weight_goal_kg,
        }))
      }

      if (p === '/api/weekly' && m === 'GET') {
        const to = q.get('to') || todayISO()
        const from = q.get('from') || shiftDate(to, -6)
        if ((new Date(to) - new Date(from)) / 86400000 > 92) return sendJson(res, 400, { error: 'range too large (max 93 days)' })
        const health = await openfit.getHealth()
        const settings = db.getSettings()
        const days = []
        for (let d = from; d <= to; d = shiftDate(d, 1)) {
          const workouts = db.listWorkouts({ from: d, to: shiftDate(d, 1) })
          const meals = db.listMeals({ from: d, to: shiftDate(d, 1) })
          days.push(summary.daySummary(d, { cached: health.data, workouts, meals }))
        }
        return sendJson(res, 200, { from, to, ...weekly.weeklySummary(days, settings) })
      }

      if (p === '/api/food/search' && m === 'GET') {
        return sendJson(res, 200, await food.searchFood(q.get('q') || ''))
      }
      if (seg[0] === 'api' && seg[1] === 'food' && seg[2] === 'barcode' && seg[3] && m === 'GET') {
        try {
          const product = await food.lookupBarcode(seg[3])
          return product ? sendJson(res, 200, product) : sendJson(res, 404, { error: 'not found' })
        } catch (e) { return sendJson(res, 502, { error: 'OpenFoodFacts lookup failed: ' + e.message }) }
      }

      if (p === '/api/reminders' && m === 'GET') return sendJson(res, 200, db.listReminders())
      if (p === '/api/reminders' && m === 'POST') return sendJson(res, 201, db.createReminder(await readBody(req)))
      if (p === '/api/reminders/due' && m === 'GET') {
        const now = new Date()
        const today = now.toISOString().slice(0, 10)
        const list = db.listReminders()
        const log = db.reminderLogFor(today)
        const due = reminderEngine.dueReminders(list, log, now)
        const results = []
        for (const r of due) {
          const outcome = await reminderEngine.sendReminder(r, `Consied reminder: ${r.kind}`)
          db.logReminderAttempt(r.id, today, outcome.status, outcome.detail)
          results.push({ reminderId: r.id, kind: r.kind, ...outcome })
        }
        return sendJson(res, 200, { checked: list.length, due: due.length, results })
      }
      if (seg[0] === 'api' && seg[1] === 'reminders' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateReminder(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'reminders' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteReminder(Number(seg[2])))

      if (p === '/api/export/json' && m === 'GET') return sendJson(res, 200, db.exportAll())
      if (seg[0] === 'api' && seg[1] === 'export' && seg[2] === 'csv' && seg[3] && m === 'GET') {
        const rows = db.exportTable(seg[3])
        if (!rows) return sendJson(res, 404, { error: 'unknown table' })
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${seg[3]}.csv"` })
        return res.end(toCsv(rows))
      }
      if (p === '/api/import/json' && m === 'POST') {
        try { return sendJson(res, 200, db.importAll(await readBody(req))) }
        catch (e) { return sendJson(res, 400, { error: 'import failed: ' + e.message }) }
      }

      if (p === '/api/summary' && m === 'GET') {
        const date = q.get('date') || todayISO()
        const to = nextDay(date)
        const health = await openfit.getHealth()
        const workouts = db.listWorkouts({ from: date, to })
        const meals = db.listMeals({ from: date, to })
        return sendJson(res, 200, summary.daySummary(date, { cached: health.data, workouts, meals }))
      }

      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
      if (p.startsWith('/media/')) return serveStatic(res, path.join(__dirname, '..', 'media'), p.slice('/media'.length))
      // Webapp removed — this service is now an MCP server; no SPA is served.
      if (p === '/' || p === '') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('consied MCP server — POST /mcp with a bearer token to connect an AI client.') }
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'not found', hint: 'This is an MCP server; use POST /mcp with a bearer token.' }))
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
  })
}

module.exports = { createServer }

if (require.main === module) {
  const root = path.join(__dirname, '..')
  const port = Number(process.env.PORT || 42815)
  createServer({
    dbFile: process.env.CONSIED_DB || path.join(root, '.data', 'consied.sqlite'),
    exercisesJson: path.join(root, 'data', 'exercises.json'),
    distDir: path.join(root, 'dist'),
  }).listen(port, '127.0.0.1', () => console.log('consied on http://127.0.0.1:' + port))
}
