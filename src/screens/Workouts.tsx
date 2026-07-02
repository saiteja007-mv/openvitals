import { useEffect, useState } from 'react'
import { api, nowLocalInput } from '../api'
import type { Workout } from '../types'
import { Button, Field, Input, Loading, Empty, Modal, useToast } from '../components/UI'

const num = (v: string) => (v === '' ? undefined : Number(v))
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export default function Workouts() {
  const [items, setItems] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Workout | 'new' | null>(null)
  const { show, node } = useToast()

  const load = () => {
    setLoading(true)
    api.listWorkouts({ from: daysAgo(60) }).then(setItems).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const del = async (id: number) => { await api.deleteWorkout(id); load(); show('Deleted') }

  return (
    <div>
      <div className="row between">
        <h1>Workouts</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>Add</Button>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No workouts yet. Log one from the Exercises tab or tap Add.</Empty></div>
      ) : (
        <div className="card" style={{ marginTop: 16, padding: 8 }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Exercise</th><th>Detail</th><th></th></tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td className="caption">{new Date(w.performed_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td>
                  <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{w.name}</td>
                  <td className="caption">{[w.sets && `${w.sets}×${w.reps ?? '-'}`, w.weight_kg && `${w.weight_kg}kg`, w.duration_min && `${w.duration_min}m`].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button className="iconbtn" onClick={() => setEditing(w)} aria-label="Edit">✎</button>
                      <button className="iconbtn" onClick={() => del(w.id)} aria-label="Delete">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <WorkoutForm
          workout={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); show('Saved') }}
        />
      )}
      {node}
    </div>
  )
}

function WorkoutForm({ workout, onClose, onDone }: { workout: Workout | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: workout?.name ?? '',
    performed_at: workout ? new Date(workout.performed_at).toISOString().slice(0, 16) : nowLocalInput(),
    sets: workout?.sets?.toString() ?? '',
    reps: workout?.reps?.toString() ?? '',
    weight_kg: workout?.weight_kg?.toString() ?? '',
    duration_min: workout?.duration_min?.toString() ?? '',
    notes: workout?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return
    setSaving(true)
    const payload = {
      name: f.name.trim(), performed_at: new Date(f.performed_at).toISOString(),
      sets: num(f.sets), reps: num(f.reps), weight_kg: num(f.weight_kg), duration_min: num(f.duration_min),
      notes: f.notes || undefined,
    }
    try {
      if (workout) await api.updateWorkout(workout.id, payload)
      else await api.createWorkout(payload)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal title={workout ? 'Edit workout' : 'Add workout'} onClose={onClose}>
      <div className="stack">
        <Field label="Exercise name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Bench press" /></Field>
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
        <Button variant="primary" onClick={save} loading={saving} disabled={!f.name.trim()}>Save</Button>
      </div>
    </Modal>
  )
}
