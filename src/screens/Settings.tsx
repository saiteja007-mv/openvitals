import { useEffect, useState } from 'react'
import { api, downloadJson } from '../api'
import type { Settings as SettingsType, Reminder, Recommendation } from '../types'
import { Button, Card, Field, Input, Select, Loading, useToast } from '../components/UI'

const CSV_TABLES = ['workouts', 'meals', 'meal_recipes', 'body_metrics', 'habits']

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const { show, node } = useToast()

  const load = () => {
    setLoading(true)
    Promise.all([api.getSettings(), api.getRecommendation().catch(() => null), api.listReminders()])
      .then(([s, r, rem]) => { setSettings(s); setRec(r); setReminders(rem) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading || !settings) return <Loading />

  return (
    <div>
      <h1>Settings</h1>

      {rec && (
        <div style={{ marginTop: 16 }}>
          <Card soft>
            <div className="stat-label">Smart recommendation</div>
            <div style={{ marginTop: 8 }}>{rec.message || 'Log a bit more data to get a recommendation.'}</div>
            {rec.flags.map((f, i) => <div key={i} className="caption" style={{ marginTop: 6, color: '#b00020' }}>{f}</div>)}
            <div className="caption" style={{ marginTop: 8 }}>{rec.disclaimer}</div>
          </Card>
        </div>
      )}

      <h3 className="section-title">Goals</h3>
      <GoalsForm settings={settings} onSaved={(s) => { setSettings(s); show('Saved') }} />

      <h3 className="section-title">Reminders</h3>
      <RemindersSection reminders={reminders} onChange={load} show={show} />

      <h3 className="section-title">Data export &amp; backup</h3>
      <ExportSection show={show} />

      <h3 className="section-title">Account</h3>
      <LogoutButton />

      {node}
    </div>
  )
}

function GoalsForm({ settings, onSaved }: { settings: SettingsType; onSaved: (s: SettingsType) => void }) {
  const [f, setF] = useState({
    calorie_goal: settings.calorie_goal?.toString() ?? '',
    protein_goal: settings.protein_goal?.toString() ?? '',
    steps_goal: settings.steps_goal?.toString() ?? '',
    sleep_goal_min: settings.sleep_goal_min?.toString() ?? '',
    weight_goal_kg: settings.weight_goal_kg?.toString() ?? '',
    height_cm: settings.height_cm?.toString() ?? '',
  })
  const [saving, setSaving] = useState(false)
  const num = (v: string) => (v === '' ? null : Number(v))
  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.updateSettings({
        calorie_goal: num(f.calorie_goal), protein_goal: num(f.protein_goal), steps_goal: num(f.steps_goal),
        sleep_goal_min: num(f.sleep_goal_min), weight_goal_kg: num(f.weight_goal_kg), height_cm: num(f.height_cm),
      })
      onSaved(saved)
    } finally { setSaving(false) }
  }
  return (
    <Card soft>
      <div className="stack">
        <div className="row">
          <Field label="Calorie goal (kcal)"><Input type="number" value={f.calorie_goal} onChange={(e) => setF({ ...f, calorie_goal: e.target.value })} /></Field>
          <Field label="Protein goal (g)"><Input type="number" value={f.protein_goal} onChange={(e) => setF({ ...f, protein_goal: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Steps goal"><Input type="number" value={f.steps_goal} onChange={(e) => setF({ ...f, steps_goal: e.target.value })} /></Field>
          <Field label="Sleep goal (min)"><Input type="number" value={f.sleep_goal_min} onChange={(e) => setF({ ...f, sleep_goal_min: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Weight goal (kg)"><Input type="number" value={f.weight_goal_kg} onChange={(e) => setF({ ...f, weight_goal_kg: e.target.value })} /></Field>
          <Field label="Height (cm, for BMI)"><Input type="number" value={f.height_cm} onChange={(e) => setF({ ...f, height_cm: e.target.value })} /></Field>
        </div>
        <Button variant="primary" onClick={save} loading={saving}>Save goals</Button>
      </div>
    </Card>
  )
}

function RemindersSection({ reminders, onChange, show }: { reminders: Reminder[]; onChange: () => void; show: (m: string) => void }) {
  const [kind, setKind] = useState('')
  const [channel, setChannel] = useState<'slack' | 'telegram'>('slack')
  const [time, setTime] = useState('20:00')
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)

  const add = async () => {
    if (!kind.trim()) return
    setSaving(true)
    try {
      await api.createReminder({ kind: kind.trim(), channel, time_of_day: time, target: target || undefined, enabled: 1 })
      setKind(''); setTarget('')
      onChange()
    } finally { setSaving(false) }
  }

  const toggle = async (r: Reminder) => { await api.updateReminder(r.id, { enabled: r.enabled ? 0 : 1 }); onChange() }
  const del = async (id: number) => { await api.deleteReminder(id); onChange() }

  const checkNow = async () => {
    setChecking(true)
    try {
      const res = await api.checkDueReminders()
      show(res.due === 0 ? 'No reminders due right now' : `${res.due} due — ${res.results.map((r) => r.status).join(', ')}`)
    } finally { setChecking(false) }
  }

  return (
    <div>
      {reminders.length > 0 && (
        <div className="stack" style={{ marginBottom: 12 }}>
          {reminders.map((r) => (
            <Card key={r.id} className="card-tight">
              <div className="row between">
                <div>
                  <strong style={{ textTransform: 'capitalize' }}>{r.kind}</strong>
                  <div className="caption">{r.channel} · {r.time_of_day} · {r.target ? 'configured' : 'no webhook set — will show as not-configured'}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="chip" onClick={() => toggle(r)}>{r.enabled ? 'On' : 'Off'}</button>
                  <button className="iconbtn" onClick={() => del(r.id)} aria-label="Delete">🗑</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card soft>
        <div className="stack">
          <div className="row">
            <Field label="Reminder"><Input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="e.g. water, weigh-in" /></Field>
            <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          </div>
          <div className="row">
            <Field label="Channel">
              <Select value={channel} onChange={(e) => setChannel(e.target.value as 'slack' | 'telegram')}>
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
              </Select>
            </Field>
            <Field label={channel === 'slack' ? 'Webhook URL' : 'botToken:chatId'}>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="optional — leave blank to just track locally" />
            </Field>
          </div>
          <div className="row">
            <Button variant="primary" onClick={add} loading={saving} disabled={!kind.trim()}>Add reminder</Button>
            <Button variant="secondary" onClick={checkNow} loading={checking}>Check due now</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function ExportSection({ show }: { show: (m: string) => void }) {
  const [table, setTable] = useState(CSV_TABLES[0])
  const [restoring, setRestoring] = useState(false)

  const exportJson = async () => {
    const data = await api.exportJson()
    downloadJson(`consied-backup-${new Date().toISOString().slice(0, 10)}.json`, data)
    show('Backup downloaded')
  }
  const exportCsv = () => window.open(api.exportCsvUrl(table), '_blank')

  const restore = async (file: File) => {
    setRestoring(true)
    try {
      const data = JSON.parse(await file.text())
      const res = await api.importJson(data)
      show(`Restored: ${res.restored.join(', ')}`)
    } catch {
      show('Restore failed — invalid backup file')
    } finally { setRestoring(false) }
  }

  return (
    <Card soft>
      <div className="stack">
        <Button variant="secondary" onClick={exportJson}>Download full backup (JSON)</Button>
        <div className="row">
          <Select value={table} onChange={(e) => setTable(e.target.value)}>
            {CSV_TABLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Button variant="secondary" onClick={exportCsv}>Download CSV</Button>
        </div>
        <Field label="Restore from backup">
          <input
            type="file" accept="application/json" disabled={restoring}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = '' }}
          />
        </Field>
        <div className="caption">Restoring replaces existing workouts, meals, templates, body metrics, habits, settings and workout plans with the backup's contents.</div>
      </div>
    </Card>
  )
}

function LogoutButton() {
  const [loading, setLoading] = useState(false)
  const logout = async () => {
    setLoading(true)
    try { await api.logout() } finally { window.dispatchEvent(new Event('consied:unauthorized')) }
  }
  return <Button variant="danger" onClick={logout} loading={loading}>Log out</Button>
}
