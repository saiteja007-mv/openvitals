// Google Health — DIRECT API access. Replaces the old openfit :42813 backend bridge:
// health-mcp now refreshes the OAuth token and calls the Google Health API itself, so the
// data is live/original from the health endpoints (no cached app layer in between).
// Reuses the shared OAuth client secret + a local copy of the refresh token → no re-login.
// (Filename kept as openfit.cjs to avoid churn; it no longer talks to any openfit backend.)
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let googleHealth = require('./google-health-service.cjs')
// Lazy: requiring this module must not force a db handle to exist (tests load it standalone).
let dbMod = null
const db = () => (dbMod ||= require('./db.cjs'))

const SECRETS_FILE = process.env.GOOGLE_HEALTH_SECRETS || path.join(os.homedir(), '.hermes', 'secrets', 'google-health-client.json')
const CRED_FILE = process.env.HEALTH_MCP_GH_CREDENTIALS || path.join(__dirname, '..', '.data', 'google-health-credentials.json')

let lastGood = null

// LOCAL date (America/Chicago), not UTC — else in the evening we'd query tomorrow's
// (empty) day and today's health data wouldn't reflect. Matches openfit's original impl.
const localIsoDate = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'))
  const creds = raw.installed || raw.web
  if (!creds?.client_id || !creds?.client_secret) throw new Error('Missing client_id/client_secret in ' + SECRETS_FILE)
  return { provider: 'google-health', clientId: creds.client_id, clientSecret: creds.client_secret, redirectUri: 'http://127.0.0.1:42813/oauth/callback' }
}
const getCreds = () => readJson(CRED_FILE, { token: null, lastSyncAt: null })
const saveCreds = (v) => fs.writeFileSync(CRED_FILE, JSON.stringify(v), { mode: 0o600 })

// Return credentials with a non-expired access token, refreshing (and persisting) if needed.
async function validToken(creds, config) {
  if (!creds.token) throw new Error('Google Health not connected (no token). Re-run the login with NordVPN off.')
  if (Number(creds.token.expiresAt || 0) > Date.now() + 90_000 && creds.token.access_token) return creds
  const token = await googleHealth.refreshAccessToken(config, creds.token)
  const updated = { ...creds, token }
  saveCreds(updated)
  return updated
}

const TTL_MS = Number(process.env.HEALTH_MCP_HEALTH_TTL_MS ?? 60_000) // reuse a fresh pull for TTL ms so rapid tool calls don't hammer the Google API (rate limits); 0 disables
let cache = null // { at, date, payload }

// ===== on-disk day cache =====
// A finished day never changes, so it only ever needs fetching once. Google returns trends in
// a rolling 14-day window and one date per call, so without this, history older than two weeks
// is unreachable no matter how often you sync.
//
// ponytail: intraday series are skipped — heartIntraday alone is ~370 KB/day against ~60 KB for
// every other endpoint combined, so caching it would be ~28 MB of blobs for 75 days that
// nothing currently queries. Drop this set if you ever need minute-resolution history.
const NO_CACHE_ENDPOINTS = new Set(['heartIntraday', 'stepsIntraday', 'caloriesIntraday'])
const PACE_MS = Number(process.env.HEALTH_MCP_BACKFILL_PACE_MS ?? 6_500) // ~31 API calls per date against a 300/min limit → ≈285/min

const nextDay = (date) => {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Caching is an optimization — a failure here must never break the read it came from.
function writeCache(payload) {
  try {
    const endpoints = {}
    for (const [k, v] of Object.entries(payload?.endpoints || {})) if (!NO_CACHE_ENDPOINTS.has(k)) endpoints[k] = v
    return db().cacheDailyHealth(payload.date, endpoints)
  } catch { return null }
}
const readCache = (date) => { try { return db().getDailyHealth(date) } catch { return null } }

async function pull(date, { force = false } = {}) {
  if (!force && cache && cache.date === date && Date.now() - cache.at < TTL_MS) return cache.payload
  const config = loadConfig()
  const creds = await validToken(getCreds(), config)
  const payload = await googleHealth.syncData(creds.token.access_token, date)
  const total = Number(payload.requestStats?.total || 0)
  const succeeded = Number(payload.requestStats?.succeeded || 0)
  if (!total || succeeded < Math.max(3, Math.ceil(total * 0.2))) throw new Error('Sync returned too few valid sources; kept previous data.')
  creds.lastSyncAt = payload.generatedAt
  saveCreds(creds)
  lastGood = payload
  cache = { at: Date.now(), date, payload }
  writeCache(payload)
  return payload
}

// Same interface the rest of health-mcp expects (getHealth / sync / getStatus).
// A past date is served from disk without touching Google; today always goes live, because
// today is still accumulating.
async function getHealth(date) {
  const d = date || localIsoDate()
  const isToday = d === localIsoDate()
  if (!isToday) {
    const hit = readCache(d)
    if (hit) return { stale: false, cached: true, data: hit }
  }
  try { return { stale: false, cached: false, data: await pull(d) } }
  catch { return { stale: true, cached: false, data: isToday ? lastGood : readCache(d) } }
}
async function sync() { return pull(localIsoDate(), { force: true }) }

// Fetch and cache every day in [from, to). Skips days already cached unless force.
// Paced against the API rate limit, so a long range takes minutes — call it from the CLI
// script (server/backfill-gh.cjs), not from a request handler that can time out.
async function backfill(from, to, { force = false, onProgress = () => {}, pauseMs = PACE_MS } = {}) {
  const today = localIsoDate()
  const dates = []
  for (let d = from; d < to; d = nextDay(d)) if (d <= today) dates.push(d)

  const result = { range: { from, to }, total: dates.length, fetched: 0, skipped: 0, failed: [], bytes: 0 }
  for (const [i, date] of dates.entries()) {
    if (!force && readCache(date)) { result.skipped++; onProgress({ date, status: 'skipped', i, of: dates.length }); continue }
    try {
      const payload = await pull(date, { force: true })
      const w = writeCache(payload)
      result.fetched++
      result.bytes += w?.bytes || 0
      onProgress({ date, status: 'fetched', i, of: dates.length, bytes: w?.bytes || 0 })
    } catch (e) {
      result.failed.push({ date, error: String(e.message || e) })
      onProgress({ date, status: 'failed', i, of: dates.length, error: String(e.message || e) })
    }
    if (pauseMs && i < dates.length - 1) await new Promise((r) => setTimeout(r, pauseMs))
  }
  return result
}
// Fetch full nutrition history (per-day macro totals + individual food items) for [from, to).
async function fetchNutrition(from, to) {
  const creds = await validToken(getCreds(), loadConfig())
  return googleHealth.fetchNutritionLog(creds.token.access_token, from, to)
}
// Exercise sessions (Google records no sets/reps — those live in the local workouts table) for [from, to).
async function fetchExerciseSessions(from, to) {
  const creds = await validToken(getCreds(), loadConfig())
  return googleHealth.fetchExerciseSessions(creds.token.access_token, from, to)
}
// One session via dataPoints.get — carries `source` (reconcile lists omit it).
async function fetchExerciseSession(id) {
  const creds = await validToken(getCreds(), loadConfig())
  return googleHealth.fetchExerciseSession(creds.token.access_token, id)
}
// TCX XML (GPS track + laps) for one session id.
async function exportExerciseTcx(id) {
  const creds = await validToken(getCreds(), loadConfig())
  return googleHealth.exportExerciseTcx(creds.token.access_token, id)
}
// Raw dataPoints for any readable type — the escape hatch when no translated tool fits.
async function queryDataPoints(type, from, to, opts) {
  const creds = await validToken(getCreds(), loadConfig())
  return googleHealth.queryDataPoints(creds.token.access_token, type, from, to, opts)
}
async function getStatus() {
  const creds = getCreds()
  let configured = false
  try { loadConfig(); configured = true } catch { /* secrets missing */ }
  return { source: 'google-health-direct', configured, connected: Boolean(creds.token?.access_token || creds.token?.refresh_token), lastSyncAt: creds.lastSyncAt || null }
}

module.exports = {
  getHealth, sync, getStatus, fetchNutrition, backfill,
  fetchExerciseSessions, fetchExerciseSession, exportExerciseTcx, queryDataPoints,
  DATA_TYPES: googleHealth.DATA_TYPES,
  cacheStats: () => db().healthCacheStats(),
  cachedDates: (range) => db().listCachedHealthDates(range),
  __setGoogleHealthForTest: (m) => { googleHealth = m },
  __setDbForTest: (m) => { dbMod = m },
}
