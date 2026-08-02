const { test } = require('node:test')
const assert = require('node:assert')
const s = require('../server/summary.cjs')

test('nutritionTotals sums nullable macros', () => {
  const t = s.nutritionTotals([{ calories: 300, protein_g: 10 }, { calories: 200, protein_g: null, carbs_g: 5 }])
  assert.equal(t.calIn, 500)
  assert.equal(t.protein, 10)
  assert.equal(t.carbs, 5)
})

test('calorieBalance net = in - out (rounded)', () => {
  assert.deepEqual(s.calorieBalance({ calIn: 2100, caloriesOut: 2450.7 }), { in: 2100, out: 2451, net: -351 })
})

test('extractHealthMetrics uses latest non-null across trends + metricTrends', () => {
  const cached = {
    date: '2026-07-01',
    endpoints: {
      activity: { summary: { caloriesOut: 1494.68 } },
      stepsTrend: { 'activities-steps': [{ dateTime: '2026-06-30', value: 7873 }, { dateTime: '2026-07-01' }] },
      heartTrend: { 'activities-heart': [{ dateTime: '2026-06-30', value: { restingHeartRate: 60 } }, { dateTime: '2026-07-01', value: {} }] },
      sleepTrend: { sleep: [{ dateTime: '2026-06-30', minutesAsleep: 431 }] },
      bodyWeight: { weight: [] },
      metricTrends: { values: [
        { dateTime: '2026-06-30', hrvMs: 73.3, spo2: 96.8, breathingRate: 18.2, distanceKm: 5.3609, activeMinutes: 25, zoneMinutes: 12, sleepEfficiency: 99 },
        { dateTime: '2026-07-01', hrvMs: null, spo2: null },
      ] },
    },
  }
  const h = s.extractHealthMetrics(cached)
  assert.equal(h.steps, 7873)          // today missing -> latest complete day
  assert.equal(h.caloriesOut, 1495)    // today's partial activity summary, rounded
  assert.equal(h.restingHr, 60)
  assert.equal(h.hrv, 73.3)
  assert.equal(h.spo2, 96.8)
  assert.equal(h.distanceKm, 5.4)
  assert.equal(h.sleepMin, 431)
  assert.equal(h.weightKg, null)       // genuinely no data
  assert.equal(h.asOf, '2026-06-30')

  const today = s.extractHealthMetrics(cached, '2026-07-01')
  assert.equal(today.steps, null)       // requested day has no exact-date row -> null, never another day's value
  assert.equal(today.restingHr, null)
  assert.equal(today.hrv, null)
  assert.equal(today.spo2, null)
  assert.equal(today.asOf, '2026-06-30') // but asOf still surfaces the real latest health date

  const calNoFallback = s.extractHealthMetrics({
    date: '2026-07-01',
    endpoints: { caloriesTrend: { 'activities-calories': [{ dateTime: '2026-06-30', value: 2222 }] } },
  }, '2026-07-01')
  assert.equal(calNoFallback.caloriesOut, null) // no live activity.summary and no exact-date trend row

  const liveCalories = s.extractHealthMetrics({
    date: '2026-07-01',
    endpoints: {
      activity: { summary: { caloriesOut: 1494.68 } },
      caloriesTrend: { 'activities-calories': [{ dateTime: '2026-07-01', value: 1000 }] },
    },
  }, '2026-07-01')
  assert.equal(liveCalories.caloriesOut, 1495)

  const localToday = new Date().toISOString().slice(0, 10)
  const noCachedDate = s.extractHealthMetrics({
    endpoints: { stepsTrend: { 'activities-steps': [{ dateTime: '2026-06-30', value: 7873 }, { dateTime: localToday }] } },
  }, localToday)
  assert.equal(noCachedDate.steps, null) // today's row exists but has no value -> null, not yesterday's count
})

test('extractHealthMetrics never mixes in another day when the requested day (incl. today) is stale/missing', () => {
  // OpenFit cache only synced through yesterday; UI requests "today" explicitly.
  const cached = {
    date: '2026-07-02',
    endpoints: {
      stepsTrend: { 'activities-steps': [{ dateTime: '2026-07-01', value: 6000 }, { dateTime: '2026-07-02', value: 8000 }] },
      sleepTrend: { sleep: [{ dateTime: '2026-07-02', minutesAsleep: 400, isMainSleep: true }] },
      heartTrend: { 'activities-heart': [{ dateTime: '2026-07-02', value: { restingHeartRate: 58 } }] },
    },
  }
  const requestedToday = s.extractHealthMetrics(cached, '2026-07-03')
  assert.equal(requestedToday.steps, null)
  assert.equal(requestedToday.sleepMin, null)
  assert.equal(requestedToday.restingHr, null)
  assert.equal(requestedToday.caloriesOut, null)
  assert.equal(requestedToday.asOf, '2026-07-02') // reports the real latest synced date, not the requested one

  // A genuine past selected date with data still resolves to its own exact-day values.
  const pastDay = s.extractHealthMetrics(cached, '2026-07-02')
  assert.equal(pastDay.steps, 8000)
  assert.equal(pastDay.sleepMin, 400)
  assert.equal(pastDay.restingHr, 58)
  assert.equal(pastDay.asOf, '2026-07-02')
})

// Regression: macros and Fitbit sessions used to read 0 because daySummary only looked at the
// local meals/workouts tables, while food and exercise are both logged in the Google Health app.
test('daySummary: macros come from the Google Health nutrition cache, not just logged meals', () => {
  const ghNutrition = { date: '2026-08-01', calories: 2652, protein: 210.1, carbs: 349.3, fat: 49.5 }
  const d = s.daySummary('2026-08-01', { cached: {}, workouts: [], meals: [], ghNutrition })
  assert.equal(d.nutrition.protein, 210.1)
  assert.equal(d.nutrition.calIn, 2652)
  assert.equal(d.nutrition.caloriesInSource, 'google_health_cache')
})

test('daySummary: falls back to logged meals when the nutrition cache has no row', () => {
  const meals = [{ calories: 500, protein_g: 40, carbs_g: 50, fat_g: 10 }]
  const d = s.daySummary('2026-08-01', { cached: {}, workouts: [], meals, ghNutrition: null })
  assert.equal(d.nutrition.protein, 40)
  assert.equal(d.nutrition.caloriesInSource, 'logged_meals')
})

test('daySummary: counts Fitbit activities as workouts for the requested date only', () => {
  const cached = { endpoints: { activities: { activities: [
    { activityName: 'Cricket', startTime: '2026-07-29T22:06:00', duration: 1024000, calories: 143, averageHeartRate: 133 },
    { activityName: 'Walk', startTime: '2026-07-28T14:36:00', duration: 913000, calories: 103 },
  ] } } }
  const d = s.daySummary('2026-07-29', { cached, workouts: [], meals: [] })
  assert.equal(d.workouts.length, 1)
  assert.equal(d.workouts[0].name, 'Cricket')
  assert.equal(d.workouts[0].duration_min, 17)
  assert.equal(d.workouts[0].avg_hr, 133)
  assert.equal(d.workouts[0].source, 'google_health')
})
