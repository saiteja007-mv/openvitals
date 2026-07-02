const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')

test('getHealth caches last good and degrades to stale', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ source: 'google-health', date: '2026-07-01' }))
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.OPENFIT_URL = 'http://127.0.0.1:' + srv.address().port
  delete require.cache[require.resolve('../server/openfit.cjs')]
  const of = require('../server/openfit.cjs')

  let h = await of.getHealth()
  assert.equal(h.stale, false)
  assert.equal(h.data.source, 'google-health')

  await new Promise((r) => srv.close(r))
  h = await of.getHealth()
  assert.equal(h.stale, true)
  assert.equal(h.data.date, '2026-07-01')
})
