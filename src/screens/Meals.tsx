import { useEffect, useState } from 'react'
import { api, todayISO } from '../api'
import type { Meal } from '../types'
import { Button, Card, Field, Input, Select, Loading, Empty, Modal, useToast } from '../components/UI'

const num = (v: string) => (v === '' ? undefined : Number(v))
const nextDay = (d: string) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
const TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

export default function Meals() {
  const [date, setDate] = useState(todayISO())
  const [items, setItems] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Meal | 'new' | null>(null)
  const { show, node } = useToast()

  const load = () => {
    setLoading(true)
    api.listMeals({ from: date, to: nextDay(date) }).then(setItems).finally(() => setLoading(false))
  }
  useEffect(load, [date])

  const del = async (id: number) => { await api.deleteMeal(id); load(); show('Deleted') }
  const totals = items.reduce((a, m) => ({
    cal: a.cal + (m.calories || 0), p: a.p + (m.protein_g || 0), c: a.c + (m.carbs_g || 0), f: a.f + (m.fat_g || 0),
  }), { cal: 0, p: 0, c: 0, f: 0 })

  return (
    <div>
      <div className="row between">
        <h1>Meals</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>Add</Button>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card soft>
          <div className="row between">
            <div>
              <div className="stat-label">Total intake</div>
              <div className="stat-value">{Math.round(totals.cal).toLocaleString()}<span className="stat-unit">kcal</span></div>
            </div>
            <div className="caption" style={{ textAlign: 'right' }}>
              Protein {Math.round(totals.p)}g · Carbs {Math.round(totals.c)}g · Fat {Math.round(totals.f)}g
            </div>
          </div>
        </Card>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <div style={{ marginTop: 16 }}><Empty>No meals logged for this day.</Empty></div>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {items.map((m) => (
            <Card key={m.id} className="card-tight">
              <div className="row between">
                <div>
                  <strong style={{ textTransform: 'capitalize' }}>{m.name}</strong>
                  <div className="caption">{m.meal_type ?? 'meal'} · {m.calories ?? 0} kcal · P{m.protein_g ?? 0} C{m.carbs_g ?? 0} F{m.fat_g ?? 0}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="iconbtn" onClick={() => setEditing(m)} aria-label="Edit">✎</button>
                  <button className="iconbtn" onClick={() => del(m.id)} aria-label="Delete">🗑</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <MealForm
          meal={editing === 'new' ? null : editing}
          defaultDate={date}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); show('Saved') }}
        />
      )}
      {node}
    </div>
  )
}

function MealForm({ meal, defaultDate, onClose, onDone }: { meal: Meal | null; defaultDate: string; onClose: () => void; onDone: () => void }) {
  const initWhen = meal ? new Date(meal.eaten_at).toISOString().slice(0, 16) : `${defaultDate}T12:00`
  const [f, setF] = useState({
    name: meal?.name ?? '', meal_type: meal?.meal_type ?? 'lunch', eaten_at: initWhen,
    calories: meal?.calories?.toString() ?? '', protein_g: meal?.protein_g?.toString() ?? '',
    carbs_g: meal?.carbs_g?.toString() ?? '', fat_g: meal?.fat_g?.toString() ?? '', notes: meal?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return
    setSaving(true)
    const payload = {
      name: f.name.trim(), meal_type: f.meal_type, eaten_at: new Date(f.eaten_at).toISOString(),
      calories: num(f.calories), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g),
      notes: f.notes || undefined,
    }
    try {
      if (meal) await api.updateMeal(meal.id, payload)
      else await api.createMeal(payload)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal title={meal ? 'Edit meal' : 'Add meal'} onClose={onClose}>
      <div className="stack">
        <Field label="Food"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Chicken rice bowl" /></Field>
        <div className="row">
          <Field label="Type"><Select value={f.meal_type} onChange={(e) => setF({ ...f, meal_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="When"><Input type="datetime-local" value={f.eaten_at} onChange={(e) => setF({ ...f, eaten_at: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Calories"><Input type="number" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} /></Field>
          <Field label="Protein (g)"><Input type="number" value={f.protein_g} onChange={(e) => setF({ ...f, protein_g: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Carbs (g)"><Input type="number" value={f.carbs_g} onChange={(e) => setF({ ...f, carbs_g: e.target.value })} /></Field>
          <Field label="Fat (g)"><Input type="number" value={f.fat_g} onChange={(e) => setF({ ...f, fat_g: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Button variant="primary" onClick={save} loading={saving} disabled={!f.name.trim()}>Save</Button>
      </div>
    </Modal>
  )
}
