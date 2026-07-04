import { useEffect, useState } from 'react'
import { api, nowLocalInput, todayISO } from '../api'
import type { Workout, WorkoutPlan, WorkoutPlanItem, PlanCompare, ProgressEntry } from '../types'
import { Button, Card, Field, Input, Select, Stat, Loading, Empty, Modal, useToast } from '../components/UI'

const num = (v: string) => (v === '' ? undefined : Number(v))
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export default function Workouts() {
  const [tab, setTab] = useState<'log' | 'plans' | 'progress'>('log')
  return (
    <div>
      <h1>Workouts</h1>
      <div className="row-wrap" style={{ marginTop: 12 }}>
        <button className={'chip' + (tab === 'log' ? ' active' : '')} onClick={() => setTab('log')}>Log</button>
        <button className={'chip' + (tab === 'plans' ? ' active' : '')} onClick={() => setTab('plans')}>Plans</button>
        <button className={'chip' + (tab === 'progress' ? ' active' : '')} onClick={() => setTab('progress')}>Progress</button>
      </div>
      {tab === 'log' && <LogTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'progress' && <ProgressTab />}
    </div>
  )
}

function LogTab() {
  const [items, setItems] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Workout | 'new' | null>(null)
  const { show, node } = useToast()

  const load = () => {
    setLoading(true)
    api.listWorkouts({ from: daysAgo(60) }).then(setItems).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const del = async (id: number) => { if (!confirm('Delete this workout?')) return; await api.deleteWorkout(id); load(); show('Deleted') }

  return (
    <div>
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => setEditing('new')}>Add</Button>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No workouts yet. Log one from the Exercises tab or tap Add.</Empty></div>
      ) : (
        <div className="card" style={{ marginTop: 16, padding: 8 }}>
          <div style={{ overflowX: 'auto' }}>
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

function PlansTab() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(null)
  const [editing, setEditing] = useState<WorkoutPlan | 'new' | null>(null)
  const { show, node } = useToast()

  const load = () => { setLoading(true); api.listWorkoutPlans().then(setPlans).finally(() => setLoading(false)) }
  useEffect(load, [])

  const del = async (id: number) => { if (!confirm('Delete this plan and all its exercises?')) return; await api.deleteWorkoutPlan(id); load(); show('Plan deleted') }

  return (
    <div>
      <div className="row between" style={{ marginTop: 16 }}>
        <div className="caption">Push / Pull / Legs and your own routines.</div>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>New plan</Button>
      </div>
      {loading ? <Loading /> : plans.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No plans yet. Create a Push / Pull / Legs routine or your own with New plan.</Empty></div>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {plans.map((p) => (
            <PlanCard
              key={p.id} plan={p} open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              onEdit={() => setEditing(p)} onDelete={() => del(p.id)} onLogged={() => show('Logged')}
            />
          ))}
        </div>
      )}
      {editing && (
        <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); show('Saved') }} />
      )}
      {node}
    </div>
  )
}

function PlanCard({ plan, open, onToggle, onEdit, onDelete, onLogged }: {
  plan: WorkoutPlan; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void; onLogged: () => void
}) {
  const [compare, setCompare] = useState<PlanCompare | null>(null)
  const refreshCompare = () => api.comparePlan(plan.id, todayISO()).then(setCompare)
  useEffect(() => { if (open) refreshCompare() }, [open, plan.id])

  return (
    <Card className="card-tight">
      <div className="row between" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <div>
          <strong>{plan.name}</strong>
          {plan.kind && <span className="tag" style={{ marginLeft: 8 }}>{plan.kind}</span>}
          <div className="caption">{plan.items.length} exercises</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="caption" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <button className="iconbtn" onClick={onEdit} aria-label="Edit">✎</button>
            <button className="iconbtn" onClick={onDelete} aria-label="Delete">🗑</button>
          </div>
        </div>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 16 }}>
          {plan.items.map((it, i) => (
            <PlanItemRow
              key={i} planId={plan.id} item={it}
              logged={(compare?.logged ?? []).filter((w) => w.name.toLowerCase() === it.name.toLowerCase())}
              onLogged={() => { onLogged(); refreshCompare() }}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function PlanItemRow({ planId, item, logged, onLogged }: { planId: number; item: WorkoutPlanItem; logged: Workout[]; onLogged: () => void }) {
  const [sets, setSets] = useState(item.target_sets?.toString() ?? '')
  const [reps, setReps] = useState(item.target_reps?.toString() ?? '')
  const [weight, setWeight] = useState(item.target_weight_kg?.toString() ?? '')
  const [saving, setSaving] = useState(false)

  const log = async () => {
    setSaving(true)
    try {
      await api.createWorkout({
        name: item.name, exercise_id: item.exercise_id ?? undefined, performed_at: new Date().toISOString(),
        sets: num(sets), reps: num(reps), weight_kg: num(weight), plan_id: planId,
      })
      onLogged()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
      <div className="row between">
        <strong style={{ textTransform: 'capitalize', fontWeight: logged.length > 0 ? 600 : undefined }}>
          {logged.length > 0 && <span aria-hidden="true" style={{ marginRight: 6 }}>✓</span>}{item.name}
        </strong>
        <span className="caption">Target {item.target_sets ?? '-'}×{item.target_reps ?? '-'}{item.target_weight_kg ? ` @ ${item.target_weight_kg}kg` : ''}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Input type="number" placeholder="Sets" value={sets} onChange={(e) => setSets(e.target.value)} />
        <Input type="number" placeholder="Reps" value={reps} onChange={(e) => setReps(e.target.value)} />
        <Input type="number" placeholder="kg" value={weight} onChange={(e) => setWeight(e.target.value)} />
        <Button size="sm" onClick={log} loading={saving}>Log</Button>
      </div>
      {logged.length > 0 && (
        <div className="caption" style={{ marginTop: 6 }}>
          Done today: {logged.map((w) => `${w.sets ?? '-'}×${w.reps ?? '-'}${w.weight_kg ? ` @ ${w.weight_kg}kg` : ''}`).join(', ')}
        </div>
      )}
    </div>
  )
}

function PlanForm({ plan, onClose, onDone }: { plan: WorkoutPlan | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [kind, setKind] = useState(plan?.kind ?? 'custom')
  const [items, setItems] = useState<WorkoutPlanItem[]>(plan?.items?.length ? plan.items : [{ name: '' }])
  const [saving, setSaving] = useState(false)

  const setItem = (i: number, patch: Partial<WorkoutPlanItem>) => setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const addItem = () => setItems((cur) => [...cur, { name: '' }])
  const removeItem = (i: number) => setItems((cur) => cur.filter((_, idx) => idx !== i))

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const cleanItems = items.filter((it) => it.name.trim()).map((it) => ({
      name: it.name.trim(), target_sets: it.target_sets || undefined, target_reps: it.target_reps || undefined, target_weight_kg: it.target_weight_kg || undefined,
    }))
    try {
      if (plan) await api.updateWorkoutPlan(plan.id, { name: name.trim(), kind, items: cleanItems })
      else await api.createWorkoutPlan({ name: name.trim(), kind, items: cleanItems })
      onDone()
    } finally { setSaving(false) }
  }

  return (
    <Modal title={plan ? 'Edit plan' : 'New plan'} onClose={onClose}>
      <div className="stack">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push Day" /></Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="push">push</option>
            <option value="pull">pull</option>
            <option value="legs">legs</option>
            <option value="custom">custom</option>
          </Select>
        </Field>
        <div className="stat-label">Exercises</div>
        <div className="stack">
          {items.map((it, i) => (
            <div key={i} className="row">
              <Input placeholder="Exercise" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
              <Input type="number" placeholder="Sets" style={{ width: 64 }} value={it.target_sets ?? ''} onChange={(e) => setItem(i, { target_sets: Number(e.target.value) || undefined })} />
              <Input type="number" placeholder="Reps" style={{ width: 64 }} value={it.target_reps ?? ''} onChange={(e) => setItem(i, { target_reps: Number(e.target.value) || undefined })} />
              <Input type="number" placeholder="kg" style={{ width: 64 }} value={it.target_weight_kg ?? ''} onChange={(e) => setItem(i, { target_weight_kg: Number(e.target.value) || undefined })} />
              <button className="iconbtn" onClick={() => removeItem(i)} aria-label="Remove">✕</button>
            </div>
          ))}
        </div>
        <Button variant="subtle" size="sm" onClick={addItem}>+ Add exercise</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>Save plan</Button>
      </div>
    </Modal>
  )
}

function ProgressTab() {
  const [items, setItems] = useState<ProgressEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { api.getProgress().then(setItems).finally(() => setLoading(false)) }, [])

  if (loading) return <Loading />
  if (!items.length) return <div style={{ marginTop: 16 }}><Empty>Log a few weighted sets to see progress here.</Empty></div>

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {items.map((p) => (
        <Card key={p.name} className="card-tight">
          <div className="row between">
            <strong style={{ textTransform: 'capitalize' }}>{p.name}</strong>
            {p.isPR && <span className="tag" style={{ background: 'var(--black)', color: '#fff' }}>PR</span>}
          </div>
          <div className="row" style={{ marginTop: 12, alignItems: 'stretch' }}>
            <div className="grow">
              <Stat
                label="Max weight" value={p.maxWeight} unit="kg"
                delta={p.deltaFromLastMonth != null ? {
                  text: `${p.deltaFromLastMonth > 0 ? '+' : ''}${p.deltaFromLastMonth}kg vs last month`,
                  dir: p.deltaFromLastMonth > 0 ? 'up' : p.deltaFromLastMonth < 0 ? 'down' : undefined,
                } : undefined}
              />
            </div>
            <div className="grow"><Stat label="Last volume" value={p.lastSessionVolume.toLocaleString()} unit="kg" /></div>
          </div>
          <div className="caption" style={{ marginTop: 8 }}>
            Last performed {new Date(p.lastPerformed).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </div>
        </Card>
      ))}
    </div>
  )
}
