const num = (v) => (v == null ? 0 : Number(v) || 0)

function nutritionTotals(meals) {
  return meals.reduce(
    (a, m) => ({
      calIn: a.calIn + num(m.calories),
      protein: a.protein + num(m.protein_g),
      carbs: a.carbs + num(m.carbs_g),
      fat: a.fat + num(m.fat_g),
    }),
    { calIn: 0, protein: 0, carbs: 0, fat: 0 }
  )
}

function calorieBalance({ calIn, caloriesOut }) {
  const i = Math.round(num(calIn))
  const o = Math.round(num(caloriesOut))
  return { in: i, out: o, net: i - o }
}

// Return the present value at the MAX date — order-independent, since OpenFit's
// trend arrays are inconsistently sorted (steps oldest-first, sleep newest-first).
function latest(arr, pick) {
  if (!Array.isArray(arr)) return { value: null, date: null }
  let best = { value: null, date: null }
  for (const row of arr) {
    const v = pick(row)
    if (v == null || v === '') continue
    const dt = row.dateTime || row.date || (row.endTime || row.startTime || '').slice(0, 10) || null
    if (!best.date || (dt && dt > best.date)) best = { value: v, date: dt }
  }
  return best
}

// Latest night's sleep: prefer the main sleep session on the most recent date, else sum all sessions that day.
function latestSleep(arr) {
  if (!Array.isArray(arr) || !arr.length) return { value: null, date: null }
  const byDate = {}
  for (const s of arr) {
    if (s.minutesAsleep == null) continue
    const dt = (s.endTime || s.startTime || s.dateTime || '').slice(0, 10)
    if (!dt) continue
    ;(byDate[dt] = byDate[dt] || []).push(s)
  }
  const dates = Object.keys(byDate).sort()
  if (!dates.length) return { value: null, date: null }
  const d = dates[dates.length - 1]
  const sessions = byDate[d]
  const main = sessions.find((s) => s.isMainSleep)
  const value = main ? main.minutesAsleep : sessions.reduce((a, s) => a + (s.minutesAsleep || 0), 0)
  return { value, date: d }
}
const r1 = (v) => (v == null ? null : Math.round(Number(v)))
const r10 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10)

// Mirrors the Google Health app: show the most recent available reading per metric,
// since "today" is often mid-sync (steps/HR/HRV land later than calories).
function extractHealthMetrics(cached) {
  const ep = (cached && cached.endpoints) || {}
  const mt = (ep.metricTrends && ep.metricTrends.values) || []
  const m = (field) => latest(mt, (r) => r[field])

  const steps = latest(ep.stepsTrend && ep.stepsTrend['activities-steps'], (r) => r.value)
  const rhr = latest(ep.heartTrend && ep.heartTrend['activities-heart'], (r) => r.value && r.value.restingHeartRate)
  const calTrend = latest(ep.caloriesTrend && ep.caloriesTrend['activities-calories'], (r) => r.value)
  const sleep = latestSleep(ep.sleepTrend && ep.sleepTrend.sleep)
  const weight = latest(ep.bodyWeight && ep.bodyWeight.weight, (r) => r.weight)
  const todayCalOut = ep.activity && ep.activity.summary ? ep.activity.summary.caloriesOut : null

  const hrv = m('hrvMs'); const spo2 = m('spo2'); const breath = m('breathingRate')
  const dist = m('distanceKm'); const active = m('activeMinutes'); const zone = m('zoneMinutes')
  const sleepEff = m('sleepEfficiency'); const skin = m('skinTemperature'); const cardio = m('cardioScore')

  const dates = [steps.date, rhr.date, hrv.date, sleep.date].filter(Boolean).sort()
  return {
    steps: r1(steps.value),
    caloriesOut: todayCalOut != null ? r1(todayCalOut) : r1(calTrend.value),
    restingHr: r1(rhr.value),
    sleepMin: r1(sleep.value),
    sleepEfficiency: r1(sleepEff.value),
    hrv: r10(hrv.value),
    spo2: r10(spo2.value),
    breathingRate: r10(breath.value),
    distanceKm: r10(dist.value),
    activeMinutes: r1(active.value),
    zoneMinutes: r1(zone.value),
    skinTemperature: r10(skin.value),
    cardioScore: r10(cardio.value),
    weightKg: r10(weight.value),
    asOf: dates.length ? dates[dates.length - 1] : (cached && cached.date) || null,
  }
}

function daySummary(date, { cached, workouts, meals }) {
  const health = extractHealthMetrics(cached)
  const nutrition = nutritionTotals(meals)
  const balance = calorieBalance({ calIn: nutrition.calIn, caloriesOut: health.caloriesOut })
  return { date, health, workouts, meals, nutrition, balance }
}

module.exports = { extractHealthMetrics, nutritionTotals, calorieBalance, daySummary, latest }
