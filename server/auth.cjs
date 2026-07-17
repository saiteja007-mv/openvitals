// Single-user auth: a password (env, or auto-generated + persisted locally) plus a signed
// session cookie. Secure by default — HEALTH_MCP_NO_AUTH=1 is an explicit opt-out for local dev only.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

let dataDir = null
let cachedAutoPassword = null

function init(dir) { dataDir = dir; cachedAutoPassword = null }

function getPassword() {
  if (process.env.HEALTH_MCP_PASSWORD) return process.env.HEALTH_MCP_PASSWORD
  if (cachedAutoPassword) return cachedAutoPassword
  if (!dataDir) throw new Error('auth.init(dataDir) required when HEALTH_MCP_PASSWORD is unset')
  const file = path.join(dataDir, 'auto-password.txt')
  if (fs.existsSync(file)) {
    cachedAutoPassword = fs.readFileSync(file, 'utf8').trim()
  } else {
    cachedAutoPassword = crypto.randomBytes(9).toString('base64url')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, cachedAutoPassword, { mode: 0o600 })
    console.error(`[health-mcp] No HEALTH_MCP_PASSWORD set — generated one and saved it to ${file} (chmod 600). Read that file to log in.`)
  }
  return cachedAutoPassword
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

function checkPassword(candidate) {
  return typeof candidate === 'string' && candidate.length > 0 && timingSafeEqualStr(candidate, getPassword())
}

// HMAC key derived from the password itself — no separate secret file to manage, and
// rotating the password naturally invalidates every outstanding session.
function signingKey() { return crypto.createHash('sha256').update('health-mcp-session-v1:' + getPassword()).digest() }

const SESSION_MAX_AGE_S = 30 * 24 * 3600 // 30 days
// In-memory cutover: logout bumps this, which invalidates every cookie issued at or before
// it — including ones this exact request replays — without needing a server-side session
// store. ponytail: resets on process restart, so a logout right before a systemd restart
// won't stick; fine for a single-user app, upgrade to a persisted store if that ever bites.
let loggedOutAt = 0

function makeSessionCookie() {
  const issuedAt = Date.now()
  const expires = issuedAt + SESSION_MAX_AGE_S * 1000
  const payload = `${issuedAt}.${expires}`
  const sig = crypto.createHmac('sha256', signingKey()).update(payload).digest('hex')
  // ponytail: no `Secure` attribute — this app is also reached over plain http://127.0.0.1
  // for local/dev verification, and Secure would silently break that. HttpOnly+SameSite
  // still block the practical theft vectors (XSS cookie read, cross-site submission).
  return `health-mcp_session=${payload}.${sig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}`
}
function clearSessionCookie() {
  loggedOutAt = Date.now()
  return 'health-mcp_session=deleted; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
}
function verifySessionCookie(cookieHeader) {
  const m = /(?:^|;\s*)health-mcp_session=([^;]+)/.exec(cookieHeader || '')
  if (!m) return false
  const [issuedAt, expires, sig] = m[1].split('.')
  if (!issuedAt || !expires || !sig) return false
  const expected = crypto.createHmac('sha256', signingKey()).update(`${issuedAt}.${expires}`).digest('hex')
  if (!timingSafeEqualStr(sig, expected)) return false
  if (Number(issuedAt) <= loggedOutAt) return false
  return Date.now() < Number(expires)
}

function parseBasicAuth(header) {
  const [scheme, enc] = (header || '').split(' ')
  if (scheme !== 'Basic' || !enc) return null
  try { return Buffer.from(enc, 'base64').toString().split(':').slice(1).join(':') } catch { return null }
}

// Explicit, non-default dev escape — never the default posture.
function noAuthEscape() {
  return process.env.HEALTH_MCP_NO_AUTH === '1' || process.env.HEALTH_MCP_NO_AUTH === 'true'
}

function authed(req) {
  if (noAuthEscape()) return true
  if (verifySessionCookie(req.headers.cookie)) return true
  const pw = parseBasicAuth(req.headers.authorization)
  return pw != null && checkPassword(pw)
}

module.exports = {
  init, getPassword, checkPassword, makeSessionCookie, clearSessionCookie,
  verifySessionCookie, parseBasicAuth, noAuthEscape, authed, SESSION_MAX_AGE_S,
}
