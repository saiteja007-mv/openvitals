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

function lastVal(arr, pick) {
  if (!Array.isArray(arr) || !arr.length) return null
  return pick(arr[arr.length - 1])
}

function extractHealthMetrics(cached, _date) {
  const ep = (cached && cached.endpoints) || {}
  const summ = (ep.activity && ep.activity.summary) || {}
  return {
    steps: summ.steps != null ? Number(summ.steps) : null,
    caloriesOut: summ.caloriesOut != null ? Math.round(Number(summ.caloriesOut)) : null,
    restingHr: lastVal(ep.heartTrend && ep.heartTrend['activities-heart'], (r) => r && r.value && r.value.restingHeartRate) || null,
    sleepMin: lastVal(ep.sleepTrend && ep.sleepTrend.sleep, (r) => r && r.minutesAsleep) || null,
    hrv: lastVal(ep.hrv && ep.hrv.hrv, (r) => r && (r.dailyRmssd || r.value)) || null,
    spo2: null,
    weightKg: lastVal(ep.bodyWeight && ep.bodyWeight.weight, (r) => r && r.weight) || null,
  }
}

function daySummary(date, { cached, workouts, meals }) {
  const health = extractHealthMetrics(cached, date)
  const nutrition = nutritionTotals(meals)
  const balance = calorieBalance({ calIn: nutrition.calIn, caloriesOut: health.caloriesOut })
  return { date, health, workouts, meals, nutrition, balance }
}

module.exports = { extractHealthMetrics, nutritionTotals, calorieBalance, daySummary }
