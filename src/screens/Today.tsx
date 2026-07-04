import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, todayISO } from '../api'
import type { DaySummary, HealthResponse, Settings, HabitStatus } from '../types'
import { Button, Card, Stat, Loading, Empty, Field, Input, useToast } from '../components/UI'

const hm = (min: number | null) => (min == null ? null : `${Math.floor(min / 60)}h ${min % 60}m`)
const fmtDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
// Progress toward a Settings goal, shown under the stat value (links the two sections; no color).
const toGoal = (cur: number | null | undefined, tgt: number | null | undefined, fmt: (v: number) => string): { text: string; dir?: 'up' } | undefined =>
  (tgt == null || cur == null) ? undefined : (cur >= tgt ? { text: 'goal reached', dir: 'up' } : { text: `${fmt(tgt - cur)} to goal` })

function GoalRow({ label, current, target, fmt }: { label: string; current: number | null; target: number | null; fmt: (v: number) => string }) {
  if (target == null) return null
  const cur = current ?? 0
  const pct = Math.max(0, Math.min(100, Math.round((cur / target) * 100)))
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between"><span className="caption">{label}</span><span className="caption">{fmt(cur)} / {fmt(target)}</span></div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--canvas-soft)' }}>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--black)', width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HabitStreakCard({ habit, onToggle }: { habit: HabitStatus; onToggle: (name: string) => void }) {
  const windowDays = habit.streak > 30 ? 60 : 30
  const days = (habit.history ?? []).slice(-windowDays)
  const doneCount = days.filter((d) => d.done).length
  const pct = days.length ? Math.round((doneCount / windowDays) * 100) : 0
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{habit.name}</strong>
          <span className="caption">{habit.streak} day streak · {doneCount}/{windowDays} days in this window</span>
        </span>
        <span className="row" style={{ gap: 8, flexShrink: 0, alignItems: 'center' }}>
          <span className="tag" style={{ background: habit.done ? 'var(--black)' : undefined, color: habit.done ? '#fff' : undefined }}>🔥 {habit.streak}d</span>
          <Button variant={habit.done ? 'secondary' : 'primary'} size="sm" onClick={() => onToggle(habit.name)} aria-pressed={habit.done}>
            {habit.done ? '✓ Logged' : 'Log'}
          </Button>
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--canvas-soft)', overflow: 'hidden' }} aria-label={`${habit.name} ${pct}% complete over ${windowDays} days`}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: 'var(--black)' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${windowDays}, minmax(3px, 1fr))`, gap: windowDays > 30 ? 2 : 3, marginTop: 10 }} aria-hidden="true">
          {days.map((d) => (
            <span key={d.date} title={`${d.date}: ${d.done ? 'done' : 'missed'}`} style={{ height: windowDays > 30 ? 18 : 22, borderRadius: 5, background: d.done ? 'var(--black)' : '#ddd', opacity: d.done ? 1 : 0.65 }} />
          ))}
        </div>
        <div className="row between caption" style={{ marginTop: 6 }}>
          <span>{days[0]?.date.slice(5) ?? ''}</span>
          <span>{windowDays}-day window{habit.streak > 30 ? ' · extended for long streak' : ''}</span>
          <span>{days[days.length - 1]?.date.slice(5) ?? ''}</span>
        </div>
      </div>
    </div>
  )
}

export default function Today() {
  const today = todayISO()
  const [date, setDate] = useState(today)
  const [sum, setSum] = useState<DaySummary | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [habits, setHabits] = useState<HabitStatus[]>([])
  const [newHabit, setNewHabit] = useState('')
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const { show, node } = useToast()
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [s, h] = await Promise.all([api.getSummary(date), api.getHealth().catch(() => ({ stale: true } as HealthResponse))])
      setSum(s)
      setStale(Boolean(h?.stale))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [date])
  useEffect(() => { api.getSettings().then(setSettings).catch(() => setSettings(null)) }, [])
  const loadHabits = () => api.listHabitStatus(date).then(setHabits).catch(() => setHabits([]))
  useEffect(() => { loadHabits() }, [date])

  const toggleHabit = async (name: string) => {
    const cur = habits.find((h) => h.name === name)
    const next = !cur?.done
    setHabits((list) => list.map((h) => h.name === name ? { ...h, done: next, streak: next ? h.streak + 1 : 0 } : h))
    try { await api.setHabit(date, name, next); await loadHabits() }
    catch { await loadHabits(); show('Could not save habit') }
  }

  const addHabit = async () => {
    const name = newHabit.trim()
    if (!name) return
    const existing = habits.some((h) => h.name.toLowerCase() === name.toLowerCase())
    try {
      if (existing) {
        show(`Already tracking "${name}"`)
        setNewHabit('')
        return
      }
      try {
        await api.createHabit(name)
      } catch {
        // Older/running backends may not have /api/habits/new yet; setting the
        // habit also creates its definition server-side. Only do this for a new
        // habit so we never overwrite an already-checked habit to false.
        await api.setHabit(date, name, false)
      }
      setNewHabit('')
      await loadHabits()
      show(`Tracking "${name}"`)
    } catch { show('Could not add habit — please try again') }
  }

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + delta)
    const s = d.toISOString().slice(0, 10)
    if (s <= today) setDate(s)
  }
  const dayLabel = date === today
    ? 'Today'
    : new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

  const sync = async () => {
    setSyncing(true)
    try { await api.postSync(); await load(); show('Synced from Google Health') }
    catch { show('Sync failed — OpenFit unreachable') }
    finally { setSyncing(false) }
  }

  // ponytail: only block on the very first load; on date change keep showing current data
  // while the next day fetches (no full-page collapse, header + day-nav stay mounted).
  if (!sum) return <Loading />
  const h = sum.health
  const b = sum.balance
  const hasIntake = b.in > 0
  const hasGoals = settings && [settings.calorie_goal, settings.protein_goal, settings.steps_goal, settings.sleep_goal_min, settings.weight_goal_kg].some((v) => v != null)

  return (
    <div>
      <div className="row between">
        <h1>{dayLabel}</h1>
        <Button variant="primary" onClick={sync} loading={syncing}>Sync</Button>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 10 }}>
        <button className="iconbtn" onClick={() => shiftDay(-1)} aria-label="Previous day">‹</button>
        <span className="caption" style={{ opacity: loading ? 0.5 : 1 }}>{fmtDay(date)}</span>
        <button className="iconbtn" onClick={() => shiftDay(1)} disabled={date >= today} style={{ opacity: date >= today ? 0.4 : 1 }} aria-label="Next day">›</button>
        {date !== today && <button className="chip" onClick={() => setDate(today)}>Today</button>}
      </div>
      {date === today && h.asOf && h.asOf !== sum.date && (
        <div className="caption" style={{ marginTop: 6 }}>Health data as of {fmtDay(h.asOf)} (today still syncing)</div>
      )}

      {stale && <div className="banner" style={{ marginTop: 16 }}>Showing last cached data — OpenFit didn’t refresh. Tap Sync to retry.</div>}

      {hasGoals ? (
        <div style={{ marginTop: 16 }}>
          <Card soft>
            <div className="stat-label">Goals</div>
            <div className="stack" style={{ marginTop: 14, gap: 16 }}>
              {settings!.calorie_goal != null && (
                <div className="row between">
                  <span className="caption">Calories remaining</span>
                  <strong>{Math.round(settings!.calorie_goal - sum.nutrition.calIn).toLocaleString()}</strong>
                </div>
              )}
              <GoalRow label="Protein" current={sum.nutrition.protein} target={settings!.protein_goal} fmt={(v) => `${Math.round(v)}g`} />
              <GoalRow label="Steps" current={h.steps} target={settings!.steps_goal} fmt={(v) => Math.round(v).toLocaleString()} />
              <GoalRow label="Sleep" current={h.sleepMin} target={settings!.sleep_goal_min} fmt={(v) => hm(Math.round(v)) ?? '0h 0m'} />
              <GoalRow label="Weight" current={h.weightKg} target={settings!.weight_goal_kg} fmt={(v) => `${v.toFixed(1)}kg`} />
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}><Empty>Set daily targets in Settings to track goals here.</Empty></div>
      )}

      <div style={{ marginTop: 16 }}>
        <Card soft>
          <div className="row between">
            <div>
              <div className="stat-label">Habit streaks</div>
              <div className="caption">Track anything — no sugar, no beverage, no junk, water, walk.</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Field label="Add habit">
              <Input
                value={newHabit}
                onChange={(e) => setNewHabit(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                placeholder="e.g. No sugar"
              />
            </Field>
            <Button variant="primary" onClick={addHabit} disabled={!newHabit.trim()}>Add</Button>
          </div>
          {habits.length === 0 ? <div style={{ marginTop: 14 }}><Empty>No habits yet.</Empty></div> : (
            <div style={{ marginTop: 14 }}>
              {habits.map((hb) => <HabitStreakCard key={hb.name} habit={hb} onToggle={toggleHabit} />)}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <Stat label="Steps" value={h.steps?.toLocaleString() ?? null} delta={toGoal(h.steps, settings?.steps_goal, (v) => Math.round(v).toLocaleString())} />
        <Stat label="Calories out" value={h.caloriesOut?.toLocaleString() ?? null} unit="kcal" />
        <Stat label="Resting HR" value={h.restingHr ?? null} unit="bpm" />
        <Stat label="Sleep" value={hm(h.sleepMin)} delta={toGoal(h.sleepMin, settings?.sleep_goal_min, (v) => hm(Math.round(v)) ?? '')} />
        <Stat label="Sleep eff." value={h.sleepEfficiency ?? null} unit="%" />
        <Stat label="HRV" value={h.hrv ?? null} unit="ms" />
        <Stat label="SpO₂" value={h.spo2 ?? null} unit="%" />
        <Stat label="Breathing" value={h.breathingRate ?? null} unit="br/min" />
        <Stat label="Distance" value={h.distanceKm ?? null} unit="km" />
        <Stat label="Active min" value={h.activeMinutes ?? null} />
        <Stat label="Zone min" value={h.zoneMinutes ?? null} />
        <Stat label="Weight" value={h.weightKg ?? null} unit="kg" />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card soft>
          <div className="row between">
            <div>
              <div className="stat-label">Calorie balance</div>
              {hasIntake ? (
                <div className="stat-value">
                  {b.net > 0 ? '+' : ''}{b.net.toLocaleString()}
                  <span className="stat-unit">net kcal</span>
                </div>
              ) : (
                <div className="caption" style={{ marginTop: 6 }}>Log a meal to see your calorie balance.</div>
              )}
            </div>
            <div className="stack" style={{ textAlign: 'right', gap: 2 }}>
              <div className="caption">In {b.in.toLocaleString()} · Out {b.out.toLocaleString()}</div>
              {hasIntake && <div className="caption">{b.net > 0 ? '▲ Surplus' : '▼ Deficit'}</div>}
            </div>
          </div>
        </Card>
      </div>

      <h3 className="section-title">Workouts</h3>
      {sum.workouts.length === 0 ? <Empty action={<Button variant="secondary" size="sm" onClick={() => nav('/workouts')}>Log a workout</Button>}>No workouts logged this day.</Empty> : (
        <div className="stack">
          {sum.workouts.map((w) => (
            <Card key={w.id} className="card-tight">
              <div className="row between">
                <div><strong style={{ textTransform: 'capitalize' }}>{w.name}</strong>
                  <div className="caption">{[w.sets && `${w.sets}×${w.reps ?? '-'}`, w.weight_kg && `${w.weight_kg}kg`, w.duration_min && `${w.duration_min}min`].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <span className="tag">{new Date(w.performed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h3 className="section-title">Meals</h3>
      {sum.meals.length === 0 ? <Empty action={<Button variant="secondary" size="sm" onClick={() => nav('/food')}>Log a meal</Button>}>No meals logged this day.</Empty> : (
        <div className="stack">
          {sum.meals.map((m) => (
            <Card key={m.id} className="card-tight">
              <div className="row between">
                <div><strong style={{ textTransform: 'capitalize' }}>{m.name}</strong>
                  <div className="caption">{m.meal_type ?? 'meal'} · {m.calories ?? 0} kcal</div>
                </div>
                <span className="tag">{[m.protein_g && `P${m.protein_g}`, m.carbs_g && `C${m.carbs_g}`, m.fat_g && `F${m.fat_g}`].filter(Boolean).join(' ') || '—'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {node}
    </div>
  )
}
