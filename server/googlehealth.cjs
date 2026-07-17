// Google Health — DIRECT API access. Replaces the old openfit :42813 backend bridge:
// health-mcp now refreshes the OAuth token and calls the Google Health API itself, so the
// data is live/original from the health endpoints (no cached app layer in between).
// Reuses the shared OAuth client secret + a local copy of the refresh token → no re-login.
// (Filename kept as openfit.cjs to avoid churn; it no longer talks to any openfit backend.)
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let googleHealth = require('./google-health-service.cjs')

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
  return payload
}

// Same interface the rest of health-mcp expects (getHealth / sync / getStatus).
async function getHealth() {
  try { return { stale: false, data: await pull(localIsoDate()) } }
  catch { return { stale: true, data: lastGood } }
}
async function sync() { return pull(localIsoDate(), { force: true }) }
async function getStatus() {
  const creds = getCreds()
  let configured = false
  try { loadConfig(); configured = true } catch { /* secrets missing */ }
  return { source: 'google-health-direct', configured, connected: Boolean(creds.token?.access_token || creds.token?.refresh_token), lastSyncAt: creds.lastSyncAt || null }
}

module.exports = { getHealth, sync, getStatus, __setGoogleHealthForTest: (m) => { googleHealth = m } }
