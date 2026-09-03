#!/usr/bin/env node
// Backfill the local Google Health day cache.
//
//   node server/backfill-gh.cjs 2026-06-11 2026-08-24   # [from, to)
//   node server/backfill-gh.cjs 2026-06-11 2026-08-24 --force
//
// Each date costs ~31 API calls against a 300/min limit, so this paces itself at one date
// every ~6.5s — a 75-day range takes about 8 minutes. Run it here rather than through the
// MCP tool, which would time out long before finishing.
const path = require('node:path')
const db = require('./db.cjs')
const googleHealth = require('./googlehealth.cjs')

const [, , from, to, ...flags] = process.argv
const force = flags.includes('--force')

if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
  console.error('usage: node server/backfill-gh.cjs <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive> [--force]')
  process.exit(1)
}

db.initDb(process.env.HEALTH_MCP_DB || path.join(__dirname, '..', '.data', 'health-mcp.sqlite'))

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const started = Date.now()

googleHealth
  .backfill(from, to, {
    force,
    onProgress: ({ date, status, i, of, bytes, error }) => {
      const n = String(i + 1).padStart(String(of).length)
      const detail = status === 'fetched' ? kb(bytes) : status === 'failed' ? error : ''
      console.log(`[${n}/${of}] ${date}  ${status.padEnd(7)} ${detail}`)
    },
  })
  .then((r) => {
    const mins = ((Date.now() - started) / 60_000).toFixed(1)
    console.log(`\nfetched ${r.fetched}, skipped ${r.skipped}, failed ${r.failed.length} in ${mins} min (${kb(r.bytes)} written)`)
    if (r.failed.length) {
      console.log('failed dates:')
      for (const f of r.failed) console.log(`  ${f.date}  ${f.error}`)
    }
    console.log('cache now:', JSON.stringify(db.healthCacheStats()))
    process.exit(r.failed.length ? 1 : 0)
  })
  .catch((e) => { console.error('backfill failed:', e.message || e); process.exit(1) })
