const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// openfit.cjs now calls the Google Health API directly (no :42813 backend). We mock the
// google-health-service via the test hook so this stays offline.
test('getHealth pulls Google Health, caches last good, degrades to stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consied-gh-'))
  const secrets = path.join(dir, 'secrets.json')
  const creds = path.join(dir, 'creds.json')
  fs.writeFileSync(secrets, JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }))
  fs.writeFileSync(creds, JSON.stringify({ token: { access_token: 'a', refresh_token: 'r', expiresAt: Date.now() + 3_600_000 } }))
  process.env.GOOGLE_HEALTH_SECRETS = secrets
  process.env.CONSIED_GH_CREDENTIALS = creds
  process.env.CONSIED_HEALTH_TTL_MS = '0' // disable the pull cache so the stale-degrade path is exercised
  delete require.cache[require.resolve('../server/googlehealth.cjs')]
  const of = require('../server/googlehealth.cjs')

  let good = true
  of.__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    syncData: async () => { if (!good) throw new Error('boom'); return { source: 'google-health', date: '2026-07-01', requestStats: { total: 10, succeeded: 10 } } },
  })

  let h = await of.getHealth()
  assert.equal(h.stale, false)
  assert.equal(h.data.source, 'google-health')

  good = false
  h = await of.getHealth()
  assert.equal(h.stale, true)
  assert.equal(h.data.date, '2026-07-01') // last good preserved

  const st = await of.getStatus()
  assert.equal(st.connected, true)
})
