#!/usr/bin/env node
// Google Health (re)consent for health-mcp. Needed whenever SCOPES changes or the refresh token dies.
//
//   node server/login-gh.cjs            → prints the consent URL, waits for the browser redirect on
//                                          http://127.0.0.1:42819/oauth/callback (browser on THIS machine)
//   node server/login-gh.cjs --finish '<url>' → finish a consent started earlier: paste the address-bar
//                                          URL the browser landed on (or the bare code).
//   node server/login-gh.cjs --paste    → same, but reads the final redirected URL (or bare code) from
//                                          stdin — for when the browser is on another device and the
//                                          127.0.0.1 redirect "fails" there; copy that address bar URL.
//
// The OAuth client is an "installed" (desktop) app, so any loopback port is a valid redirect; the port only
// has to match between the auth URL and the token exchange, which this script controls end to end.
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const gh = require('./google-health-service.cjs')

const SECRETS_FILE = process.env.GOOGLE_HEALTH_SECRETS || path.join(os.homedir(), '.hermes', 'secrets', 'google-health-client.json')
const CRED_FILE = process.env.HEALTH_MCP_GH_CREDENTIALS || path.join(__dirname, '..', '.data', 'google-health-credentials.json')
const PORT = Number(process.env.HEALTH_MCP_LOGIN_PORT || 42819)
const redirectUri = `http://127.0.0.1:${PORT}/oauth/callback`

const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'))
const c = raw.installed || raw.web
const config = { provider: 'google-health', clientId: c.client_id, clientSecret: c.client_secret, redirectUri }
const PENDING = path.join(path.dirname(CRED_FILE), 'gh-login-pending.json')
const finishing = process.argv.indexOf('--finish')
// --finish <redirect-url-or-code>: complete a consent started by an earlier run (its PKCE verifier and
// state are persisted, because the browser is usually on another machine and the code arrives later).
const pending = finishing !== -1 ? JSON.parse(fs.readFileSync(PENDING, 'utf8')) : null
const pkce = pending ? { verifier: pending.verifier, challenge: null } : gh.createPkce()
const state = pending ? pending.state : crypto.randomBytes(16).toString('hex')
if (!pending) fs.mkdirSync(path.dirname(PENDING), { recursive: true }), fs.writeFileSync(PENDING, JSON.stringify({ verifier: pkce.verifier, state, redirectUri }), { mode: 0o600 })
const url = pending ? null : gh.createAuthorizationUrl(config, state, pkce)

function codeFrom(input) {
  const t = String(input || '').trim()
  if (!t) return null
  if (!/^https?:\/\//.test(t)) return { code: t, state } // bare code pasted
  const u = new URL(t)
  return { code: u.searchParams.get('code'), state: u.searchParams.get('state') }
}

async function finish({ code, state: got }) {
  if (!code) throw new Error('no code in the input')
  if (got !== state) throw new Error('state mismatch — use the URL from THIS run, not an older one')
  const token = await gh.exchangeAuthorizationCode(config, code, pkce.verifier)
  let prev = {}
  try { prev = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) } catch { /* first login */ }
  // A consent that returns no refresh_token (rare, but happens when Google thinks one is already issued)
  // must not wipe the working one.
  const merged = { ...prev, token: { ...token, refresh_token: token.refresh_token || prev.token?.refresh_token } }
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  fs.writeFileSync(CRED_FILE, JSON.stringify(merged), { mode: 0o600 })
  const scopes = String(token.scope || '').split(/\s+/).map((s) => s.split('/').pop()).sort()
  console.log(`\nSaved ${CRED_FILE}\nGranted scopes (${scopes.length}):\n  ${scopes.join('\n  ')}`)
  const missing = gh.scopes.filter((s) => !String(token.scope || '').includes(s.split('/').pop()) && s !== 'openid' && s !== 'profile')
  if (missing.length) console.log(`\nNOT granted (unticked on the consent screen?):\n  ${missing.map((s) => s.split('/').pop()).join('\n  ')}`)
  try { fs.unlinkSync(PENDING) } catch { /* already gone */ }
  console.log('\nRestart the server so it picks the token up: systemctl --user restart health-mcp')
}

if (pending) {
  finish(codeFrom(process.argv[finishing + 1])).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
  return
}
console.log(`Open this URL in a browser signed in to the Google account that owns the health data:\n\n${url}\n`)
if (process.argv.includes('--paste')) {
  console.log(`After consenting, the browser lands on ${redirectUri}?code=… — if that page fails to load (browser on another device), that is expected: paste the FULL address-bar URL here and press Enter:`)
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { buf += d; if (buf.includes('\n')) { process.stdin.pause(); finish(codeFrom(buf)).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1) }) } })
} else {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, redirectUri)
    if (u.pathname !== '/oauth/callback') { res.writeHead(404).end(); return }
    try {
      await finish(codeFrom(u.toString()))
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Google Health connected — you can close this tab.')
      server.close(); process.exit(0)
    } catch (e) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Login failed: ' + e.message)
      console.error('FAILED:', e.message); server.close(); process.exit(1)
    }
  })
  server.listen(PORT, '127.0.0.1', () => console.log(`Waiting for the redirect on ${redirectUri} … (Ctrl-C to abort; use --paste if the browser is on another device)`))
}
