const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { sendJson, readBody } = require('./http-helpers.cjs')
const db = require('./db.cjs')
const exercises = require('./exercises.cjs')
const openfit = require('./openfit.cjs')
const summary = require('./summary.cjs')

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

function nextDay(date) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function createServer({ dbFile, exercisesJson, distDir }) {
  db.initDb(dbFile)
  exercises.loadExercises(exercisesJson)
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      const p = u.pathname
      const m = req.method
      const q = u.searchParams
      const seg = p.split('/').filter(Boolean)

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

      if (p === '/api/meals' && m === 'GET') return sendJson(res, 200, db.listMeals({ from: q.get('from'), to: q.get('to') }))
      if (p === '/api/meals' && m === 'POST') return sendJson(res, 201, db.createMeal(await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'meals' && seg[2] && m === 'PATCH') return sendJson(res, 200, db.updateMeal(Number(seg[2]), await readBody(req)))
      if (seg[0] === 'api' && seg[1] === 'meals' && seg[2] && m === 'DELETE') return sendJson(res, 200, db.deleteMeal(Number(seg[2])))

      if (p === '/api/summary' && m === 'GET') {
        const date = q.get('date') || new Date().toISOString().slice(0, 10)
        const to = nextDay(date)
        const health = await openfit.getHealth()
        const workouts = db.listWorkouts({ from: date, to })
        const meals = db.listMeals({ from: date, to })
        return sendJson(res, 200, summary.daySummary(date, { cached: health.data, workouts, meals }))
      }

      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
      return serveStatic(res, distDir, p)
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
