import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { api } from '../api'
import type { Meal } from '../types'
import { Card, Loading, Empty } from '../components/UI'

const RANGES = [7, 30, 90]
const shortDate = (d: string) => { const x = new Date(d); return `${x.getMonth() + 1}/${x.getDate()}` }

// Dedup by date, sort ascending — OpenFit trend arrays are inconsistently ordered.
function toSeries(arr: any[] | undefined, pick: (r: any) => any) {
  if (!Array.isArray(arr)) return [] as { date: string; value: number; label: string }[]
  const m: Record<string, number> = {}
  for (const r of arr) {
    const d = r.dateTime || r.date
    const v = pick(r)
    if (d && v != null && v !== '') m[d] = Number(v)
  }
  return Object.keys(m).sort().map((date) => ({ date, value: m[date], label: shortDate(date) }))
}

function sleepSeries(arr: any[] | undefined) {
  if (!Array.isArray(arr)) return [] as { date: string; value: number; label: string }[]
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
  const [days, setDays] = useState(30)
  const [health, setHealth] = useState<any>(null)
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    Promise.all([api.getHealth(), api.listMeals({ from })])
      .then(([h, m]) => { setHealth(h.data); setMeals(m) })
      .finally(() => setLoading(false))
  }, [days])

  const ep = health?.endpoints || {}
  const mt = ep.metricTrends?.values
  const cut = <T,>(a: T[]) => a.slice(-days)

  const steps = useMemo(() => cut(toSeries(ep.stepsTrend?.['activities-steps'], (r) => r.value)), [health, days])
  const restHr = useMemo(() => cut(toSeries(ep.heartTrend?.['activities-heart'], (r) => r.value?.restingHeartRate)), [health, days])
  const hrv = useMemo(() => cut(toSeries(mt, (r) => r.hrvMs)), [health, days])
  const spo2 = useMemo(() => cut(toSeries(mt, (r) => r.spo2)), [health, days])
  const dist = useMemo(() => cut(toSeries(mt, (r) => r.distanceKm)), [health, days])
  const sleep = useMemo(() => cut(sleepSeries(ep.sleepTrend?.sleep)), [health, days])
  const weight = useMemo(() => cut(toSeries(ep.bodyWeight?.weight, (r) => r.weight)), [health, days])

  const calCompare = useMemo(() => {
    const calIn: Record<string, number> = {}
    meals.forEach((m) => { const d = (m.eaten_at || '').slice(0, 10); calIn[d] = (calIn[d] || 0) + (m.calories || 0) })
    const calOut = Object.fromEntries(toSeries(ep.caloriesTrend?.['activities-calories'], (r) => r.value).map((p) => [p.date, p.value]))
    const dates = [...new Set([...Object.keys(calIn), ...Object.keys(calOut)])].sort()
    return cut(dates.map((d) => ({ label: shortDate(d), In: Math.round(calIn[d] || 0), Out: Math.round((calOut[d] as number) || 0) })))
  }, [health, meals, days])

  if (loading) return <Loading />

  return (
    <div>
      <div className="row between">
        <h1>Trends</h1>
        <div className="row-wrap">
          {RANGES.map((r) => <button key={r} className={'chip' + (days === r ? ' active' : '')} onClick={() => setDays(r)}>{r}d</button>)}
        </div>
      </div>

      <ChartCard title="Steps">{bar(steps, 'steps')}</ChartCard>
      <ChartCard title="Calories — in vs out">
        {calCompare.some((d) => d.In || d.Out)
          ? <ResponsiveContainer width="100%" height={220}><LineChart data={calCompare}><CartesianGrid vertical={false} stroke="#efefef" /><XAxis dataKey="label" tick={AX} interval="preserveStartEnd" /><YAxis tick={AX} width={44} /><Tooltip /><Legend /><Line type="monotone" dataKey="Out" stroke="#000000" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="In" stroke="#afafaf" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
          : <NoData />}
      </ChartCard>
      <ChartCard title="Resting heart rate">{line(restHr, 'bpm', true)}</ChartCard>
      <ChartCard title="Heart-rate variability (ms)">{line(hrv, 'ms')}</ChartCard>
      <ChartCard title="Blood oxygen (SpO₂ %)">{line(spo2, '%', true)}</ChartCard>
      <ChartCard title="Sleep (hours)">{bar(sleep, 'hours')}</ChartCard>
      <ChartCard title="Distance (km)">{line(dist, 'km')}</ChartCard>
      <ChartCard title="Weight (kg)">{line(weight, 'kg', true)}</ChartCard>
    </div>
  )
}

const AX = { fontSize: 11, fill: '#afafaf' }
type Pt = { label: string; value: number }
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
function NoData() { return <Empty>No data for this metric yet.</Empty> }
