const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const path = require('node:path')

test('server smoke: exercises, workout, meal, summary', async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2400 } } } }))
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  process.env.OPENFIT_URL = 'http://127.0.0.1:' + stub.address().port

  const { createServer } = require('../server/index.cjs')
  const srv = createServer({
    dbFile: ':memory:',
    exercisesJson: path.join(__dirname, '..', 'data', 'exercises.json'),
    distDir: path.join(__dirname, '..', 'dist'),
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  const g = async (u, o) => (await fetch(base + u, o)).json()

  assert.ok((await g('/api/exercises?q=sit-up')).total >= 1)

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

  await new Promise((r) => srv.close(r))
  await new Promise((r) => stub.close(r))
})
