const { test } = require('node:test')
const assert = require('node:assert')
const { dueReminders, sendReminder, hhmmNow } = require('../server/reminders.cjs')

test('hhmmNow formats local time as HH:MM', () => {
  const d = new Date(2026, 5, 1, 9, 5)
  assert.equal(hhmmNow(d), '09:05')
})

test('dueReminders: fires enabled reminders whose time has passed and not yet sent today', () => {
  const reminders = [
    { id: 1, enabled: 1, time_of_day: '08:00' }, // due
    { id: 2, enabled: 1, time_of_day: '23:00' }, // not due yet
    { id: 3, enabled: 0, time_of_day: '08:00' }, // disabled
  ]
  const now = new Date(2026, 5, 1, 9, 0)
  const due = dueReminders(reminders, [], now)
  assert.deepEqual(due.map((r) => r.id), [1])
})

test('dueReminders: skips reminders already marked sent today', () => {
  const reminders = [{ id: 1, enabled: 1, time_of_day: '08:00' }]
  const log = [{ reminder_id: 1, status: 'sent' }]
  const now = new Date(2026, 5, 1, 9, 0)
  assert.deepEqual(dueReminders(reminders, log, now), [])
})

test('sendReminder: reports skipped_not_configured instead of faking success', async () => {
  const r = await sendReminder({ channel: 'slack', target: null }, 'hi')
  assert.equal(r.status, 'skipped_not_configured')
})

test('sendReminder: actually posts to a configured Slack webhook', async () => {
  let posted = null
  const fakeFetch = async (url, opts) => { posted = { url, body: JSON.parse(opts.body) }; return { ok: true } }
  const r = await sendReminder({ channel: 'slack', target: 'https://hooks.slack.com/services/T00/B00/xyz' }, 'drink water', fakeFetch)
  assert.equal(r.status, 'sent')
  assert.equal(posted.url, 'https://hooks.slack.com/services/T00/B00/xyz')
  assert.equal(posted.body.text, 'drink water')
})

test('sendReminder: rejects a non-hooks.slack.com target without making the request (SSRF guard)', async () => {
  let called = false
  const fakeFetch = async () => { called = true; return { ok: true } }
  const r = await sendReminder({ channel: 'slack', target: 'http://169.254.169.254/latest/meta-data/' }, 'hi', fakeFetch)
  assert.equal(r.status, 'failed')
  assert.equal(called, false)
})

test('sendReminder: telegram requires "token:chatId" target shape', async () => {
  const r = await sendReminder({ channel: 'telegram', target: 'not-valid' }, 'hi')
  assert.equal(r.status, 'skipped_not_configured')
})

test('sendReminder: reports failed on non-ok response, without throwing', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 })
  const r = await sendReminder({ channel: 'slack', target: 'https://hooks.slack.com/services/T00/B00/xyz' }, 'hi', fakeFetch)
  assert.equal(r.status, 'failed')
})
