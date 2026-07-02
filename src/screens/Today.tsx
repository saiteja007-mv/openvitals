import { useEffect, useState } from 'react'
import { api, todayISO } from '../api'
import type { DaySummary, HealthResponse } from '../types'
import { Button, Card, Stat, Loading, Empty, useToast } from '../components/UI'

const hm = (min: number | null) => (min == null ? null : `${Math.floor(min / 60)}h ${min % 60}m`)

export default function Today() {
  const [sum, setSum] = useState<DaySummary | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const { show, node } = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [s, h] = await Promise.all([api.getSummary(todayISO()), api.getHealth().catch(() => ({ stale: true } as HealthResponse))])
      setSum(s)
      setStale(Boolean(h?.stale))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const sync = async () => {
    setSyncing(true)
    try { await api.postSync(); await load(); show('Synced from Google Health') }
    catch { show('Sync failed — OpenFit unreachable') }
    finally { setSyncing(false) }
  }

  if (loading || !sum) return <Loading />
  const h = sum.health
  const b = sum.balance
  const netCls = b.net > 0 ? 'net-neg' : 'net-pos'

  return (
    <div>
      <div className="row between">
        <h1>Today</h1>
        <Button variant="primary" onClick={sync} loading={syncing}>Sync</Button>
      </div>
      <div className="caption" style={{ marginTop: 4 }}>
        {h.asOf && h.asOf !== sum.date ? `Health data as of ${h.asOf} (today still syncing)` : sum.date}
      </div>

      {stale && <div className="banner" style={{ marginTop: 16 }}>Showing last cached data — OpenFit didn’t refresh. Tap Sync to retry.</div>}

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <Stat label="Steps" value={h.steps?.toLocaleString() ?? null} />
        <Stat label="Calories out" value={h.caloriesOut?.toLocaleString() ?? null} unit="kcal" />
        <Stat label="Resting HR" value={h.restingHr ?? null} unit="bpm" />
        <Stat label="Sleep" value={hm(h.sleepMin)} />
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
              <div className="stat-value">
                <span className={netCls}>{b.net > 0 ? '+' : ''}{b.net.toLocaleString()}</span>
                <span className="stat-unit">net kcal</span>
              </div>
            </div>
            <div className="stack" style={{ textAlign: 'right', gap: 2 }}>
              <div className="caption">In {b.in.toLocaleString()} · Out {b.out.toLocaleString()}</div>
              <div className="caption">{b.net > 0 ? 'Surplus' : 'Deficit'}</div>
            </div>
          </div>
        </Card>
      </div>

      <h3 className="section-title">Workouts</h3>
      {sum.workouts.length === 0 ? <Empty>No workouts logged today.</Empty> : (
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
      {sum.meals.length === 0 ? <Empty>No meals logged today.</Empty> : (
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
