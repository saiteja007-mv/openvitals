import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { api, todayISO } from '../api'
import type { Meal, WeeklySummary } from '../types'
import { Card, Stat, Loading, Empty } from '../components/UI'

const RANGES = [7, 30, 90]
const shortDate = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}` }
const shiftDate = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

type Pt = { date: string; value: number; label: string }

// Dedup by date, sort ascending — OpenFit trend arrays are inconsistently ordered.
function toSeries(arr: any[] | undefined, pick: (r: any) => any): Pt[] {
  if (!Array.isArray(arr)) return []
  const m: Record<string, number> = {}
  for (const r of arr) {
    const d = r.dateTime || r.date
    const v = pick(r)
    if (d && v != null && v !== '') m[d] = Number(v)
  }
  return Object.keys(m).sort().map((date) => ({ date, value: m[date], label: shortDate(date) }))
}

function sleepSeries(arr: any[] | undefined): Pt[] {
  if (!Array.isArray(arr)) return []
  const byDate: Record<string, any[]> = {}
  for (const s of arr) {
    if (s.minutesAsleep == null) continue
    const d = (s.endTime || s.startTime || s.dateTime || '').slice(0, 10)
    if (!d) continue
    ;(byDate[d] = byDate[d] || []).push(s)
  }
  return Object.keys(byDate).sort().map((d) => {
    const ss = byDate[d]
    const main = ss.find((x) => x.isMainSleep)
    const v = main ? main.minutesAsleep : ss.reduce((a, x) => a + (x.minutesAsleep || 0), 0)
    return { date: d, value: +(v / 60).toFixed(1), label: shortDate(d) }
  })
}

export default function Trends() {
  const [tab, setTab] = useState<'charts' | 'weekly'>('charts')
  const [days, setDays] = useState(30)
  const [page, setPage] = useState(0) // 0 = most recent window; higher = older
  const [health, setHealth] = useState<any>(null)
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.getHealth(), api.listMeals({})])
      .then(([h, m]) => { setHealth(h.data); setMeals(m) })
      .finally(() => setLoading(false))
  }, [])

  const ep = health?.endpoints || {}
  const mt = ep.metricTrends?.values

  // full (unsliced) series
  const stepsAll = useMemo(() => toSeries(ep.stepsTrend?.['activities-steps'], (r) => r.value), [health])
  const restHrAll = useMemo(() => toSeries(ep.heartTrend?.['activities-heart'], (r) => r.value?.restingHeartRate), [health])
  const hrvAll = useMemo(() => toSeries(mt, (r) => r.hrvMs), [health])
  const spo2All = useMemo(() => toSeries(mt, (r) => r.spo2), [health])
  const distAll = useMemo(() => toSeries(mt, (r) => r.distanceKm), [health])
  const sleepAll = useMemo(() => sleepSeries(ep.sleepTrend?.sleep), [health])
  const weightAll = useMemo(() => toSeries(ep.bodyWeight?.weight, (r) => r.weight), [health])
  const calAll = useMemo(() => {
    const calIn: Record<string, number> = {}
    meals.forEach((m) => { const d = (m.eaten_at || '').slice(0, 10); calIn[d] = (calIn[d] || 0) + (m.calories || 0) })
    const calOut = Object.fromEntries(toSeries(ep.caloriesTrend?.['activities-calories'], (r) => r.value).map((p) => [p.date, p.value]))
    const dates = [...new Set([...Object.keys(calIn), ...Object.keys(calOut)])].sort()
    return dates.map((d) => ({ date: d, label: shortDate(d), In: Math.round(calIn[d] || 0), Out: Math.round((calOut[d] as number) || 0) }))
  }, [health, meals])

  const allSeries = [stepsAll, restHrAll, hrvAll, spo2All, distAll, sleepAll, weightAll]
  const maxDate = useMemo(() => {
    let m = ''
    for (const s of allSeries) if (s.length && s[s.length - 1].date > m) m = s[s.length - 1].date
    for (const c of calAll) if (c.date > m) m = c.date
    return m
  }, [health, meals])
  const minDate = useMemo(() => {
    let m = ''
    for (const s of allSeries) if (s.length && (!m || s[0].date < m)) m = s[0].date
    for (const c of calAll) if (!m || c.date < m) m = c.date
    return m
  }, [health, meals])

  const end = maxDate ? shiftDate(maxDate, -page * days) : ''
  const start = end ? shiftDate(end, -(days - 1)) : ''
  const inWin = (d: string) => d >= start && d <= end
  const win = (s: Pt[]) => s.filter((p) => inWin(p.date))
  const canOlder = Boolean(minDate) && start > minDate
  const rangeLabel = start && end ? `${shortDate(start)} – ${shortDate(end)}` : ''

  const setRange = (r: number) => { setDays(r); setPage(0) }

  if (loading) return <Loading />

  return (
    <div>
      <div className="row between">
        <h1>Trends</h1>
        {tab === 'charts' && (
          <div className="row-wrap">
            {RANGES.map((r) => <button key={r} className={'chip' + (days === r ? ' active' : '')} onClick={() => setRange(r)}>{r}d</button>)}
          </div>
        )}
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <button className={'chip' + (tab === 'charts' ? ' active' : '')} onClick={() => setTab('charts')}>Charts</button>
        <button className={'chip' + (tab === 'weekly' ? ' active' : '')} onClick={() => setTab('weekly')}>Weekly</button>
      </div>

      {tab === 'weekly' ? <WeeklyTab /> : (
        <>
          <div className="row" style={{ marginTop: 16, gap: 10 }}>
            <button className="iconbtn" onClick={() => setPage((p) => p + 1)} disabled={!canOlder} style={{ opacity: canOlder ? 1 : 0.4 }} aria-label="Older">‹</button>
            <span className="caption">{rangeLabel}</span>
            <button className="iconbtn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ opacity: page === 0 ? 0.4 : 1 }} aria-label="Newer">›</button>
            {page !== 0 && <button className="chip" onClick={() => setPage(0)}>Latest</button>}
          </div>

          <ChartCard title="Steps">{bar(win(stepsAll), 'steps')}</ChartCard>
          <ChartCard title="Calories — in vs out">
            {(() => { const d = calAll.filter((c) => inWin(c.date)); return d.some((x) => x.In || x.Out)
              ? <ResponsiveContainer width="100%" height={220}><LineChart data={d}><CartesianGrid vertical={false} stroke="#efefef" /><XAxis dataKey="label" tick={AX} interval="preserveStartEnd" /><YAxis tick={AX} width={44} /><Tooltip /><Legend /><Line type="monotone" dataKey="Out" stroke="#000000" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="In" stroke="#afafaf" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
              : <NoData /> })()}
          </ChartCard>
          <ChartCard title="Resting heart rate">{line(win(restHrAll), 'bpm', true)}</ChartCard>
          <ChartCard title="Heart-rate variability (ms)">{line(win(hrvAll), 'ms')}</ChartCard>
          <ChartCard title="Blood oxygen (SpO₂ %)">{line(win(spo2All), '%', true)}</ChartCard>
          <ChartCard title="Sleep (hours)">{bar(win(sleepAll), 'hours')}</ChartCard>
          <ChartCard title="Distance (km)">{line(win(distAll), 'km')}</ChartCard>
          <ChartCard title="Weight (kg)">{line(win(weightAll), 'kg', true)}</ChartCard>
        </>
      )}
    </div>
  )
}

function WeeklyTab() {
  const [offset, setOffset] = useState(0) // 0 = 7-day window ending today; higher = further back
  const [data, setData] = useState<WeeklySummary | null>(null)
  const [loading, setLoading] = useState(true)

  const to = shiftDate(todayISO(), -offset * 7)
  const from = shiftDate(to, -6)

  useEffect(() => {
    setLoading(true)
    api.getWeekly(from, to).then(setData).finally(() => setLoading(false))
  }, [from, to])

  if (loading || !data) return <Loading />

  const hm = (min: number | null) => (min == null ? null : `${Math.floor(min / 60)}h ${min % 60}m`)

  return (
    <div>
      <div className="row" style={{ marginTop: 16, gap: 10 }}>
        <button className="iconbtn" onClick={() => setOffset((o) => o + 1)} aria-label="Older week">‹</button>
        <span className="caption">{shortDate(from)} – {shortDate(to)}</span>
        <button className="iconbtn" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} style={{ opacity: offset === 0 ? 0.4 : 1 }} aria-label="Newer week">›</button>
        {offset !== 0 && <button className="chip" onClick={() => setOffset(0)}>This week</button>}
      </div>

      <div className="grid grid-stats" style={{ marginTop: 16 }}>
        <Stat label="Avg calories" value={data.avgCalories != null ? Math.round(data.avgCalories).toLocaleString() : null} unit="kcal" />
        <Stat label="Avg protein" value={data.avgProtein ?? null} unit="g" />
        <Stat label="Workouts" value={data.workoutCount} />
        <Stat label="Avg steps" value={data.avgSteps?.toLocaleString() ?? null} />
        <Stat label="Avg sleep" value={hm(data.avgSleepMin)} />
        <Stat label="Weight change" value={data.weightChange != null ? `${data.weightChange > 0 ? '+' : ''}${data.weightChange}` : null} unit="kg" />
      </div>

      {(data.bestDay || data.worstDay) && (
        <div className="row-wrap" style={{ marginTop: 16 }}>
          {data.bestDay && <span className="tag">Best day: {data.bestDay}</span>}
          {data.worstDay && data.worstDay !== data.bestDay && <span className="tag">Worst day: {data.worstDay}</span>}
        </div>
      )}

      {data.insights.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Card soft>
            <div className="stat-label">Insights</div>
            <div className="stack" style={{ marginTop: 10 }}>
              {data.insights.map((ins, i) => <div key={i} className="caption">• {ins}</div>)}
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}><Empty>Set goals in Settings to unlock weekly insights.</Empty></div>
      )}
    </div>
  )
}

const AX = { fontSize: 11, fill: '#afafaf' }
function bar(data: Pt[], name: string) {
  if (!data.length) return <NoData />
  return <ResponsiveContainer width="100%" height={200}><BarChart data={data}><CartesianGrid vertical={false} stroke="#efefef" /><XAxis dataKey="label" tick={AX} interval="preserveStartEnd" /><YAxis tick={AX} width={40} /><Tooltip /><Bar dataKey="value" name={name} fill="#000000" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
}
function line(data: Pt[], name: string, tight = false) {
  if (!data.length) return <NoData />
  return <ResponsiveContainer width="100%" height={200}><LineChart data={data}><CartesianGrid vertical={false} stroke="#efefef" /><XAxis dataKey="label" tick={AX} interval="preserveStartEnd" /><YAxis tick={AX} width={42} domain={tight ? ['dataMin - 2', 'dataMax + 2'] : [0, 'auto']} /><Tooltip /><Line type="monotone" dataKey="value" name={name} stroke="#000000" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
}
function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ marginTop: 16 }}><Card><h3 style={{ marginBottom: 12 }}>{title}</h3>{children}</Card></div>
}
function NoData() { return <Empty>No data for this range.</Empty> }
