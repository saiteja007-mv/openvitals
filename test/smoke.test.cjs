const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const path = require('node:path')

test('server smoke: exercises, workout, meal, summary', async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ date: '2026-07-01', endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2400 } } } }))
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  process.env.OPENFIT_URL = 'http://127.0.0.1:' + stub.address().port
  process.env.HEALTH_MCP_NO_AUTH = '1' // this file exercises feature endpoints, not the auth gate (see auth.test.cjs / smoke auth test below)

  // openfit.cjs now calls Google Health directly; inject a mock so the smoke stays offline.
  const fs = require('node:fs'), os = require('node:os')
  const gdir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-mcp-gh-'))
  fs.writeFileSync(path.join(gdir, 's.json'), JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }))
  fs.writeFileSync(path.join(gdir, 'c.json'), JSON.stringify({ token: { access_token: 'a', refresh_token: 'r', expiresAt: Date.now() + 3_600_000 } }))
  process.env.GOOGLE_HEALTH_SECRETS = path.join(gdir, 's.json')
  process.env.HEALTH_MCP_GH_CREDENTIALS = path.join(gdir, 'c.json')
  require('../server/googlehealth.cjs').__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    syncData: async () => ({ date: '2026-07-01', endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2400 } } }, requestStats: { total: 10, succeeded: 10 } }),
  })

  const { createServer } = require('../server/index.cjs')
  const srv = createServer({
    dbFile: ':memory:',
    exercisesJson: path.join(__dirname, '..', 'data', 'exercises.json'),
    distDir: path.join(__dirname, '..', 'dist'),
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  const g = async (u, o) => (await fetch(base + u, o)).json()

  try {
    assert.ok((await g('/api/exercises?q=sit-up')).total >= 1)

    const recipes = await g('/api/meal-recipes')
    const pulao = recipes.find((r) => r.name === 'Chicken pulao')
    assert.ok(pulao)
    assert.equal(pulao.calories, 680)
    assert.equal(pulao.protein_g, 50)

    const w = await g('/api/workouts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Squat', performed_at: '2026-07-01T10:00:00' }),
    })
    assert.ok(w.id)

    await g('/api/meals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300 }),
    })

    const sum = await g('/api/summary?date=2026-07-01')
    assert.equal(typeof sum.balance.net, 'number')
    assert.equal(sum.balance.out, 2400)
    assert.equal(sum.balance.in, 300)

    // goals/targets
    const settings = await g('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protein_goal: 150, steps_goal: 10000 }) })
    assert.equal(settings.protein_goal, 150)

    // habit tracker
    await g('/api/habits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-07-01', habit: 'water', done: true }) })
    assert.deepEqual(await g('/api/habits?date=2026-07-01'), { water: true })

    // custom habit creation (Today screen "Add habit")
    const created = await g('/api/habits/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No soda' }) })
    assert.equal(created.name, 'No soda')
    const status = await g('/api/habits/status?date=2026-07-01')
    const noSodaStatus = status.find((h) => h.name === 'No soda')
    assert.ok(noSodaStatus)
    assert.equal(noSodaStatus.history.length, 30)

    // body metrics
    const body = await g('/api/body', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-07-01', weight_kg: 80 }) })
    assert.equal(body.weight_kg, 80)

    // workout plans + planned-vs-actual compare
    const plans = await g('/api/workout-plans')
    assert.ok(plans.some((pl) => pl.name === 'Push Day'))
    const pushDay = plans.find((pl) => pl.name === 'Push Day')
    await g('/api/workouts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bench press', performed_at: '2026-07-01T11:00:00', sets: 4, reps: 8, weight_kg: 60, plan_id: pushDay.id }),
    })
    const compare = await g(`/api/workout-plans/${pushDay.id}/compare?date=2026-07-01`)
    assert.equal(compare.logged.length, 1) // only Bench press carries this plan_id — Squat doesn't
    assert.ok(compare.planned.some((it) => it.name === 'Bench press'))

    // progressive overload
    const prog = await g('/api/progress')
    assert.ok(prog.some((x) => x.name === 'Bench press'))

    // weekly summary (Squat + Bench press were both logged on 2026-07-01)
    const wk = await g('/api/weekly?from=2026-07-01&to=2026-07-01')
    assert.equal(wk.days, 1)
    assert.equal(wk.workoutCount, 2)

    // smart recommendation (advisory)
    const rec = await g('/api/recommendation')
    assert.match(rec.disclaimer, /not medical advice/i)

    // reminders: configured but no webhook -> honest "not configured", never fakes sending
    await g('/api/reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'water', channel: 'slack', time_of_day: '00:00' }) })
    const due = await g('/api/reminders/due')
    assert.ok(due.due >= 1)
    assert.equal(due.results[0].status, 'skipped_not_configured')

    // export / import round-trip
    const dump = await g('/api/export/json')
    assert.ok(dump.workouts.length >= 1)
    assert.ok(!('reminders' in dump))
    const restore = await g('/api/import/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dump) })
    assert.ok(restore.restored.includes('workouts'))
    const csv = await (await fetch(base + '/api/export/csv/workouts')).text()
    assert.match(csv, /Bench press/)
  } finally {
    await new Promise((r) => srv.close(r))
    await new Promise((r) => stub.close(r))
    delete process.env.HEALTH_MCP_NO_AUTH
  }
})

test('server smoke: redirects Cloudflare http visitors to https before routing', async () => {
  process.env.HEALTH_MCP_NO_AUTH = '1'
  const { createServer } = require('../server/index.cjs')
  const srv = createServer({
    dbFile: ':memory:',
    exercisesJson: path.join(__dirname, '..', 'data', 'exercises.json'),
    distDir: path.join(__dirname, '..', 'dist'),
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port

  try {
    const res = await fetch(base + '/api/status?x=1', {
      redirect: 'manual',
      headers: { 'x-forwarded-host': 'health.example.com', 'x-forwarded-proto': 'http' },
    })
    assert.equal(res.status, 308)
    assert.equal(res.headers.get('location'), 'https://health.example.com/api/status?x=1')
  } finally {
    await new Promise((r) => srv.close(r))
    delete process.env.HEALTH_MCP_NO_AUTH
  }
})

test('server smoke: auth gate blocks by default; login cookie grants access; logout revokes it', async () => {
  delete process.env.HEALTH_MCP_NO_AUTH
  process.env.HEALTH_MCP_PASSWORD = 'smoke-test-pw'
  const { createServer } = require('../server/index.cjs')
  const srv = createServer({
    dbFile: ':memory:',
    exercisesJson: path.join(__dirname, '..', 'data', 'exercises.json'),
    distDir: path.join(__dirname, '..', 'dist'),
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port

  try {
    const unauthed = await fetch(base + '/api/settings')
    assert.equal(unauthed.status, 401)

    const badLogin = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) })
    assert.equal(badLogin.status, 401)

    const goodLogin = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'smoke-test-pw' }) })
    assert.equal(goodLogin.status, 200)
    const cookie = goodLogin.headers.get('set-cookie').split(';')[0]

    const authedRes = await fetch(base + '/api/settings', { headers: { cookie } })
    assert.equal(authedRes.status, 200)

    await fetch(base + '/api/logout', { method: 'POST', headers: { cookie } })
    const afterLogout = await fetch(base + '/api/settings', { headers: { cookie } })
    assert.equal(afterLogout.status, 401)
  } finally {
    await new Promise((r) => srv.close(r))
    delete process.env.HEALTH_MCP_PASSWORD
  }
})
