import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { api, todayISO, fileToDataUrl } from '../api'
import type { BodyMetric, Settings } from '../types'
import { Button, Card, Field, Input, Stat, Loading, Empty, useToast } from '../components/UI'

const AX = { fontSize: 11, fill: '#afafaf' }
const shortDate = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}` }
const num = (v: string) => (v === '' ? undefined : Number(v))
const lastWith = (rows: BodyMetric[], key: keyof BodyMetric) => [...rows].reverse().find((m) => m[key] != null)?.[key] as number | undefined

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

  const sorted = useMemo(() => [...metrics].sort((a, b) => a.date.localeCompare(b.date)), [metrics])
  const weightSeries = useMemo(() => sorted.filter((m) => m.weight_kg != null).map((m) => ({ label: shortDate(m.date), value: m.weight_kg as number })), [sorted])
  const latestWeight = lastWith(sorted, 'weight_kg') ?? null
  const bmi = latestWeight != null && settings?.height_cm ? latestWeight / (settings.height_cm / 100) ** 2 : null

  if (loading) return <Loading />

  return (
    <div>
      <h1>Body</h1>

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <Stat label="Weight" value={latestWeight ?? null} unit="kg" />
        <Stat label="BMI" value={bmi != null ? bmi.toFixed(1) : null} />
        <Stat label="Body fat" value={lastWith(sorted, 'body_fat_pct') ?? null} unit="%" />
        <Stat label="Waist" value={lastWith(sorted, 'waist_cm') ?? null} unit="cm" />
      </div>
      {!settings?.height_cm && <div className="caption" style={{ marginTop: 8 }}>Set your height in Settings to compute BMI.</div>}

      {weightSeries.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <h3 style={{ marginBottom: 12 }}>Weight trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weightSeries}>
                <CartesianGrid vertical={false} stroke="#efefef" />
                <XAxis dataKey="label" tick={AX} />
                <YAxis tick={AX} width={40} domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#000000" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <h3 className="section-title">Log an entry</h3>
      <EntryForm onSaved={() => { load(); show('Saved') }} />

      <h3 className="section-title">History</h3>
      {sorted.length === 0 ? <Empty>No body metrics logged yet.</Empty> : (
        <div className="stack">
          {[...sorted].reverse().map((m) => (
            <Card key={m.id} className="card-tight">
              <div className="row between">
                <div>
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
                </div>
                {m.photo_ref && <img src={api.bodyPhotoUrl(m.photo_ref)} alt="progress" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />}
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
        <div className="row">
          <Field label="Weight (kg)"><Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Body fat (%)"><Input type="number" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field label="Waist (cm)"><Input type="number" value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
          <Field label="Chest (cm)"><Input type="number" value={chest} onChange={(e) => setChest(e.target.value)} /></Field>
          <Field label="Arm (cm)"><Input type="number" value={arm} onChange={(e) => setArm(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Progress photo (private, optional)"><input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
        <Button variant="primary" onClick={save} loading={saving}>Save entry</Button>
      </div>
    </Card>
  )
}
