import { useEffect, useMemo, useState } from 'react'
import { api, nowLocalInput } from '../api'
import type { Exercise, Facets } from '../types'
import { Button, Field, Input, Select, Loading, Empty, Modal, useToast } from '../components/UI'

const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#efefef"/><text x="100" y="80" font-family="sans-serif" font-size="14" fill="#afafaf" text-anchor="middle">no preview</text></svg>`
)

function stepsOf(ex: Exercise): string[] {
  const s = ex.instruction_steps
  if (Array.isArray(s)) return s as string[]
  if (s && typeof s === 'object') return (s as Record<string, string[]>).en || Object.values(s)[0] || []
  if (ex.instructions?.en) return ex.instructions.en.split('. ').filter(Boolean)
  return []
}

export default function Exercises() {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [q, setQ] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [equipment, setEquipment] = useState('')
  const [items, setItems] = useState<Exercise[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Exercise | null>(null)
  const [logFor, setLogFor] = useState<Exercise | null>(null)
  const { show, node } = useToast()

  useEffect(() => { api.getFacets().then(setFacets) }, [])
  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => {
      api.searchExercises({ q, bodyPart, equipment, limit: 48 })
        .then((r) => { setItems(r.items); setTotal(r.total) })
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(t)
  }, [q, bodyPart, equipment])

  return (
    <div>
      <h1>Exercises</h1>
      <div className="caption" style={{ marginTop: 4 }}>{total.toLocaleString()} exercises</div>

      <div className="stack" style={{ marginTop: 16, marginBottom: 16 }}>
        <Input placeholder="Search exercises…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row-wrap">
          <Select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All body parts</option>
            {facets?.bodyParts.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={equipment} onChange={(e) => setEquipment(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All equipment</option>
            {facets?.equipment.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </div>
      </div>

      {loading ? <Loading /> : items.length === 0 ? <Empty>No exercises match.</Empty> : (
        <div className="grid exgrid">
          {items.map((ex) => (
            <div key={ex.id} className="excard" onClick={() => setDetail(ex)}>
              <img className="exthumb" loading="lazy" src={ex.image_url || ex.gif_url || ex.image || PLACEHOLDER} alt={ex.name}
                onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER }} />
              <div className="exbody">
                <div className="exname">{ex.name}</div>
                <div className="extag">{ex.target} · {ex.equipment}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <img className="exthumb" style={{ borderRadius: 12 }} src={detail.image_url || detail.gif_url || detail.image || PLACEHOLDER} alt={detail.name}
            onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER }} />
          <div className="row-wrap" style={{ margin: '12px 0' }}>
            <span className="tag">{detail.body_part}</span>
            <span className="tag">{detail.target}</span>
            <span className="tag">{detail.equipment}</span>
          </div>
          <ol className="stack" style={{ paddingLeft: 18, color: 'var(--body)', fontSize: 14 }}>
            {stepsOf(detail).map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={() => { setLogFor(detail); setDetail(null) }}>Log this workout</Button>
          </div>
        </Modal>
      )}

      {logFor && (
        <LogWorkoutModal exercise={logFor} onClose={() => setLogFor(null)} onDone={() => { setLogFor(null); show('Workout logged') }} />
      )}
      {node}
    </div>
  )
}

function LogWorkoutModal({ exercise, onClose, onDone }: { exercise: Exercise; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ performed_at: nowLocalInput(), sets: '', reps: '', weight_kg: '', duration_min: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const num = (v: string) => (v === '' ? undefined : Number(v))
  const save = async () => {
    setSaving(true)
    try {
      await api.createWorkout({
        exercise_id: exercise.id, name: exercise.name,
        performed_at: new Date(f.performed_at).toISOString(),
        sets: num(f.sets), reps: num(f.reps), weight_kg: num(f.weight_kg), duration_min: num(f.duration_min),
        notes: f.notes || undefined,
      })
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal title={`Log: ${exercise.name}`} onClose={onClose}>
      <div className="stack">
        <Field label="When"><Input type="datetime-local" value={f.performed_at} onChange={(e) => setF({ ...f, performed_at: e.target.value })} /></Field>
        <div className="row">
          <Field label="Sets"><Input type="number" value={f.sets} onChange={(e) => setF({ ...f, sets: e.target.value })} /></Field>
          <Field label="Reps"><Input type="number" value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Weight (kg)"><Input type="number" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: e.target.value })} /></Field>
          <Field label="Duration (min)"><Input type="number" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Button variant="primary" onClick={save} loading={saving}>Save workout</Button>
      </div>
    </Modal>
  )
}
