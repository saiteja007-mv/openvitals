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

const rowDate = (r) => r.dateTime || r.date || (r.endTime || r.startTime || '').slice(0, 10) || null

// Present value at the MAX date — order-independent (OpenFit arrays sort inconsistently).
function latest(arr, pick) {
  if (!Array.isArray(arr)) return { value: null, date: null }
  let best = { value: null, date: null }
  for (const r of arr) {
    const v = pick(r)
    if (v == null || v === '') continue
    const d = rowDate(r)
    if (!best.date || (d && d > best.date)) best = { value: v, date: d }
  }
  return best
}

// Value for an exact date, else null.
function valueOn(arr, pick, date) {
  if (!Array.isArray(arr)) return null
  for (const r of arr) {
    if (rowDate(r) === date) { const v = pick(r); if (v != null && v !== '') return v }
  }
  return null
}

function latestSleep(arr) {
  if (!Array.isArray(arr) || !arr.length) return { value: null, date: null }
  const byDate = {}
  for (const s of arr) {
    if (s.minutesAsleep == null) continue
    const d = (s.endTime || s.startTime || s.dateTime || '').slice(0, 10)
    if (d) (byDate[d] = byDate[d] || []).push(s)
  }
  const dates = Object.keys(byDate).sort()
  if (!dates.length) return { value: null, date: null }
  return { value: sleepMinutes(byDate[dates[dates.length - 1]]), date: dates[dates.length - 1] }
}
function sleepOn(arr, date) {
  if (!Array.isArray(arr)) return null
  const s = arr.filter((x) => x.minutesAsleep != null && (x.endTime || x.startTime || x.dateTime || '').slice(0, 10) === date)
  return s.length ? sleepMinutes(s) : null
}
function sleepMinutes(sessions) {
  const main = sessions.find((x) => x.isMainSleep)
  return main ? main.minutesAsleep : sessions.reduce((a, x) => a + (x.minutesAsleep || 0), 0)
}

const r1 = (v) => (v == null ? null : Math.round(Number(v)))
const r10 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10)

// date optional. If omitted or >= today (OpenFit's cached.date), fall back to latest-available
// (mirrors Google Health "today" tiles while today is mid-sync). For a past date, show that exact day.
function extractHealthMetrics(cached, date) {
  const ep = (cached && cached.endpoints) || {}
  const mt = (ep.metricTrends && ep.metricTrends.values) || []
  const today = (cached && cached.date) || new Date().toISOString().slice(0, 10)
  const fb = !date || date >= today

  const M = (arr, pick) => {
    if (date) { const v = valueOn(arr, pick, date); if (v != null) return v }
    return fb ? latest(arr, pick).value : null
  }
  const sleepMin = (() => {
    if (date) { const v = sleepOn(ep.sleepTrend && ep.sleepTrend.sleep, date); if (v != null) return v }
    return fb ? latestSleep(ep.sleepTrend && ep.sleepTrend.sleep).value : null
  })()

  const calTrend = ep.caloriesTrend && ep.caloriesTrend['activities-calories']
  const calToday = ep.activity && ep.activity.summary ? ep.activity.summary.caloriesOut : null
  let calOut = date ? valueOn(calTrend, (r) => r.value, date) : latest(calTrend, (r) => r.value).value
  // OpenFit's current day (or no-date/latest view) has live partial calories in activity.summary;
  // if that is unavailable during mid-sync, keep showing the latest trend value.
  if (calToday != null && (!date || date === today)) calOut = calToday
  if (calOut == null && fb) calOut = latest(calTrend, (r) => r.value).value

  const stepsV = M(ep.stepsTrend && ep.stepsTrend['activities-steps'], (r) => r.value)
  const latestStepsDate = latest(ep.stepsTrend && ep.stepsTrend['activities-steps'], (r) => r.value).date
  const asOf = fb ? (latestStepsDate || today || date) : date

  return {
    steps: r1(stepsV),
    caloriesOut: r1(calOut),
    restingHr: r1(M(ep.heartTrend && ep.heartTrend['activities-heart'], (r) => r.value && r.value.restingHeartRate)),
    sleepMin: r1(sleepMin),
    sleepEfficiency: r1(M(mt, (r) => r.sleepEfficiency)),
    hrv: r10(M(mt, (r) => r.hrvMs)),
    spo2: r10(M(mt, (r) => r.spo2)),
    breathingRate: r10(M(mt, (r) => r.breathingRate)),
    distanceKm: r10(M(mt, (r) => r.distanceKm)),
    activeMinutes: r1(M(mt, (r) => r.activeMinutes)),
    zoneMinutes: r1(M(mt, (r) => r.zoneMinutes)),
    skinTemperature: r10(M(mt, (r) => r.skinTemperature)),
    cardioScore: r10(M(mt, (r) => r.cardioScore)),
    weightKg: r10(M(ep.bodyWeight && ep.bodyWeight.weight, (r) => r.weight)),
    asOf,
  }
}

function daySummary(date, { cached, workouts, meals }) {
  const health = extractHealthMetrics(cached, date)
  const nutrition = nutritionTotals(meals)
  const balance = calorieBalance({ calIn: nutrition.calIn, caloriesOut: health.caloriesOut })
  return { date, health, workouts, meals, nutrition, balance }
}

module.exports = { extractHealthMetrics, nutritionTotals, calorieBalance, daySummary, latest, latestSleep }
