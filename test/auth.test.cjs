const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const auth = require('../server/auth.cjs')

test('checkPassword: accepts the configured password, rejects others', () => {
  process.env.CONSIED_PASSWORD = 'correct-horse'
  try {
    assert.equal(auth.checkPassword('correct-horse'), true)
    assert.equal(auth.checkPassword('wrong'), false)
    assert.equal(auth.checkPassword(''), false)
    assert.equal(auth.checkPassword(undefined), false)
  } finally { delete process.env.CONSIED_PASSWORD }
})

test('session cookie: sign, verify, tamper-detect, expire', () => {
  process.env.CONSIED_PASSWORD = 'pw-for-signing'
  try {
    const setCookie = auth.makeSessionCookie()
    const value = /consied_session=([^;]+)/.exec(setCookie)[1]
    assert.equal(auth.verifySessionCookie(`consied_session=${value}`), true)

    const [issuedAt, expires] = value.split('.')
    assert.equal(auth.verifySessionCookie(`consied_session=${issuedAt}.${expires}.deadbeef`), false) // tampered signature
    assert.equal(auth.verifySessionCookie('consied_session=garbage'), false)
    assert.equal(auth.verifySessionCookie(''), false)

    const pastIssuedAt = String(Date.now() - 2000)
    const pastExpires = String(Date.now() - 1000)
    const key = crypto.createHash('sha256').update('consied-session-v1:pw-for-signing').digest()
    const pastSig = crypto.createHmac('sha256', key).update(`${pastIssuedAt}.${pastExpires}`).digest('hex')
    assert.equal(auth.verifySessionCookie(`consied_session=${pastIssuedAt}.${pastExpires}.${pastSig}`), false) // expired
  } finally { delete process.env.CONSIED_PASSWORD }
})

test('logout invalidates previously issued sessions, even if the old cookie is replayed', () => {
  process.env.CONSIED_PASSWORD = 'pw-for-logout'
  try {
    const value = /consied_session=([^;]+)/.exec(auth.makeSessionCookie())[1]
    assert.equal(auth.verifySessionCookie(`consied_session=${value}`), true)
    auth.clearSessionCookie()
    assert.equal(auth.verifySessionCookie(`consied_session=${value}`), false)
  } finally { delete process.env.CONSIED_PASSWORD }
})

test('clearSessionCookie expires immediately', () => {
  assert.match(auth.clearSessionCookie(), /Max-Age=0/)
})

test('parseBasicAuth extracts the password half of user:pass', () => {
  const enc = Buffer.from('anyuser:s3cret').toString('base64')
  assert.equal(auth.parseBasicAuth(`Basic ${enc}`), 's3cret')
  assert.equal(auth.parseBasicAuth('Bearer xyz'), null)
  assert.equal(auth.parseBasicAuth(undefined), null)
})

test('noAuthEscape is off by default and only on with explicit env', () => {
  delete process.env.CONSIED_NO_AUTH
  assert.equal(auth.noAuthEscape(), false)
  process.env.CONSIED_NO_AUTH = '1'
  assert.equal(auth.noAuthEscape(), true)
  delete process.env.CONSIED_NO_AUTH
})

test('authed(): session cookie, Basic auth, and escape hatch grant access; nothing else does', () => {
  process.env.CONSIED_PASSWORD = 'pw123'
  try {
    const cookie = /consied_session=([^;]+)/.exec(auth.makeSessionCookie())[1]
    assert.equal(auth.authed({ headers: { cookie: `consied_session=${cookie}` } }), true)
    const basic = Buffer.from('u:pw123').toString('base64')
    assert.equal(auth.authed({ headers: { authorization: `Basic ${basic}` } }), true)
    assert.equal(auth.authed({ headers: {} }), false)

    process.env.CONSIED_NO_AUTH = '1'
    assert.equal(auth.authed({ headers: {} }), true)
  } finally {
    delete process.env.CONSIED_PASSWORD
    delete process.env.CONSIED_NO_AUTH
  }
})

test('getPassword: auto-generates and persists a password to disk (mode 600) when unset', () => {
  delete process.env.CONSIED_PASSWORD
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consied-auth-test-'))
  try {
    auth.init(dir)
    const p1 = auth.getPassword()
    assert.ok(p1.length >= 10)
    const file = path.join(dir, 'auto-password.txt')
    assert.ok(fs.existsSync(file))
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)

    auth.init(dir) // simulate a restart: cache cleared, must re-read the same persisted password
    assert.equal(auth.getPassword(), p1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    auth.init(null)
  }
})

test('getPassword: throws rather than silently allowing access when unconfigured', () => {
  delete process.env.CONSIED_PASSWORD
  auth.init(null)
  assert.throws(() => auth.getPassword())
})
