const BASE = () => process.env.OPENFIT_URL || 'http://127.0.0.1:42813'

let lastGood = null

async function j(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error('openfit ' + r.status)
  return r.json()
}

async function getHealth() {
  try {
    const data = await j(BASE() + '/api/cached')
    lastGood = data
    return { stale: false, data }
  } catch {
    return { stale: true, data: lastGood }
  }
}

async function sync() {
  const data = await j(BASE() + '/api/sync', { method: 'POST' })
  lastGood = data
  return data
}

async function getStatus() {
  try {
    return await j(BASE() + '/api/status')
  } catch {
    return { connected: false, reachable: false }
  }
}

module.exports = { getHealth, sync, getStatus }
