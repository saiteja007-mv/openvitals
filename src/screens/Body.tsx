import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { api, todayISO, fileToDataUrl } from '../api'
import type { BodyMetric, Settings } from '../types'
import { Button, Card, Field, Input, Stat, Loading, Empty, useToast } from '../components/UI'
import { CHART, AXIS, TOOLTIP } from '../components/chart'

const shortDate = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}` }
const num = (v: string) => (v === '' ? undefined : Number(v))
const lastWith = (rows: BodyMetric[], key: keyof BodyMetric) => [...rows].reverse().find((m) => m[key] != null)?.[key] as number | undefined
const prevWith = (rows: BodyMetric[], key: keyof BodyMetric) => { const v = rows.filter((m) => m[key] != null); return v.length > 1 ? (v[v.length - 2][key] as number) : undefined }
// Signed change vs the previous logged value — monochrome ▲/▼ via the Stat delta slot (no red/green).
function deltaOf(rows: BodyMetric[], key: keyof BodyMetric, unit: string, digits = 1): { text: string; dir?: 'up' | 'down' } | undefined {
  const cur = lastWith(rows, key), prev = prevWith(rows, key)
  if (cur == null || prev == null) return undefined
  const d = Math.round((cur - prev) * 10 ** digits) / 10 ** digits
  if (d === 0) return { text: `no change` }
  return { text: `${d > 0 ? '+' : ''}${d}${unit} vs last`, dir: d > 0 ? 'up' : 'down' }
}

export default function Body() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const { show, node } = useToast()

  const load = () => {
    setLoading(true)
    Promise.all([api.listBodyMetrics({}), api.getSettings()])
      .then(([m, s]) => { setMetrics(m); setSettings(s) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  const del = async (id: number) => { if (!confirm('Delete this entry?')) return; await api.deleteBodyMetric(id); load(); show('Deleted') }

  const sorted = useMemo(() => [...metrics].sort((a, b) => a.date.localeCompare(b.date)), [metrics])
  const weightSeries = useMemo(() => sorted.filter((m) => m.weight_kg != null).map((m) => ({ label: shortDate(m.date), value: m.weight_kg as number })), [sorted])
  const latestWeight = lastWith(sorted, 'weight_kg') ?? null
  const bmi = latestWeight != null && settings?.height_cm ? latestWeight / (settings.height_cm / 100) ** 2 : null

  if (loading) return <Loading />

  return (
    <div>
      <h1>Body</h1>

      {sorted.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>Log your first entry below to start tracking weight, BMI, body fat and measurements over time.</Empty></div>
      ) : (
        <>
          <div className="grid grid-stats" style={{ marginTop: 16 }}>
            <Stat label="Weight" value={latestWeight ?? null} unit="kg" delta={deltaOf(sorted, 'weight_kg', 'kg')} />
            <Stat label="BMI" value={bmi != null ? bmi.toFixed(1) : null} />
            <Stat label="Body fat" value={lastWith(sorted, 'body_fat_pct') ?? null} unit="%" delta={deltaOf(sorted, 'body_fat_pct', '%')} />
            <Stat label="Waist" value={lastWith(sorted, 'waist_cm') ?? null} unit="cm" delta={deltaOf(sorted, 'waist_cm', 'cm')} />
          </div>
          {!settings?.height_cm && <div className="caption" style={{ marginTop: 8 }}>Set your height in Settings to compute BMI.</div>}

          {weightSeries.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <Card>
                <h3 style={{ marginBottom: 12 }}>Weight trend</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={weightSeries}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={AXIS} />
                    <YAxis tick={AXIS} width={40} domain={['auto', 'auto']} />
                    <Tooltip {...TOOLTIP} formatter={(v) => [`${v} kg`, 'Weight']} />
                    <Line type="monotone" dataKey="value" stroke={CHART.ink} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}
        </>
      )}

      <h3 className="section-title">Log an entry</h3>
      <EntryForm onSaved={() => { load(); show('Saved') }} />

      <h3 className="section-title">History</h3>
      {sorted.length === 0 ? <Empty>No body metrics logged yet.</Empty> : (
        <div className="stack">
          {[...sorted].reverse().map((m) => (
            <Card key={m.id} className="card-tight">
              <div className="row between">
                <div style={{ minWidth: 0 }}>
                  <strong>{m.date}</strong>
                  <div className="caption">
                    {[
                      m.weight_kg != null && `${m.weight_kg}kg`,
                      m.body_fat_pct != null && `${m.body_fat_pct}% BF`,
                      m.waist_cm != null && `Waist ${m.waist_cm}cm`,
                      m.chest_cm != null && `Chest ${m.chest_cm}cm`,
                      m.arm_cm != null && `Arm ${m.arm_cm}cm`,
                    ].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {m.notes && <div className="caption mute-soft" style={{ marginTop: 2 }}>{m.notes}</div>}
                </div>
                <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                  {m.photo_ref && <img src={api.bodyPhotoUrl(m.photo_ref)} alt="progress" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />}
                  <button className="iconbtn" onClick={() => del(m.id)} aria-label="Delete entry">🗑</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {node}
    </div>
  )
}

function EntryForm({ onSaved }: { onSaved: () => void }) {
  const [date, setDate] = useState(todayISO())
  const [weight, setWeight] = useState('')
  const [bodyFat, setBodyFat] = useState('')
  const [waist, setWaist] = useState('')
  const [chest, setChest] = useState('')
  const [arm, setArm] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    setSaving(true)
    try {
      await api.upsertBodyMetric(date, {
        weight_kg: num(weight), body_fat_pct: num(bodyFat), waist_cm: num(waist), chest_cm: num(chest), arm_cm: num(arm), notes: notes || undefined,
      })
      if (photo) { const dataUrl = await fileToDataUrl(photo); await api.uploadBodyPhoto(date, dataUrl) }
      setWeight(''); setBodyFat(''); setWaist(''); setChest(''); setArm(''); setNotes(''); setPhoto(null)
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <Card soft>
      <div className="stack">
        <Field label="Date"><Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="row-wrap">
          <Field label="Weight (kg)"><Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Body fat (%)"><Input type="number" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} /></Field>
        </div>
        <div className="row-wrap">
          <Field label="Waist (cm)"><Input type="number" value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
          <Field label="Chest (cm)"><Input type="number" value={chest} onChange={(e) => setChest(e.target.value)} /></Field>
          <Field label="Arm (cm)"><Input type="number" value={arm} onChange={(e) => setArm(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="field">
          <span className="label">Progress photo (private, optional)</span>
          <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <div className="row-wrap">
            <Button type="button" variant="subtle" size="sm" onClick={() => photoRef.current?.click()}>{photo ? 'Change photo' : 'Add photo'}</Button>
            {photo && <span className="caption">{photo.name}</span>}
          </div>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!weight && !bodyFat && !waist && !chest && !arm && !photo}>Save entry</Button>
      </div>
    </Card>
  )
}
