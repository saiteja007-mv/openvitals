// Reminder due-check (pure) + delivery (I/O, honest about missing config — never fakes success).
function hhmmNow(now) {
  const d = now instanceof Date ? now : new Date(now)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dueReminders(reminders, logForToday, now) {
  const nowHHMM = hhmmNow(now)
  const sentIds = new Set(logForToday.filter((l) => l.status === 'sent').map((l) => l.reminder_id))
  return reminders.filter((r) => r.enabled && r.time_of_day <= nowHHMM && !sentIds.has(r.id))
}

async function sendReminder(reminder, message, fetchImpl = fetch) {
  const target = reminder.target
  if (!target) return { status: 'skipped_not_configured', detail: 'No Slack/Telegram credentials configured for this reminder.' }
  try {
    if (reminder.channel === 'slack') {
      const r = await fetchImpl(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message }) })
      return r.ok ? { status: 'sent', detail: null } : { status: 'failed', detail: `Slack webhook responded ${r.status}` }
    }
    if (reminder.channel === 'telegram') {
      const [token, chatId] = String(target).split(':')
      if (!token || !chatId) return { status: 'skipped_not_configured', detail: 'target must be "<botToken>:<chatId>"' }
      const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: message }),
      })
      return r.ok ? { status: 'sent', detail: null } : { status: 'failed', detail: `Telegram API responded ${r.status}` }
    }
    return { status: 'skipped_not_configured', detail: `Unknown channel "${reminder.channel}"` }
  } catch (e) {
    return { status: 'failed', detail: e.message }
  }
}

module.exports = { dueReminders, sendReminder, hhmmNow }
