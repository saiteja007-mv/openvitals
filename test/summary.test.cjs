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
  assert.equal(today.steps, 7873)       // requested current day still falls back while mid-sync
  assert.equal(today.restingHr, 60)
  assert.equal(today.hrv, 73.3)
  assert.equal(today.spo2, 96.8)

  const calFallback = s.extractHealthMetrics({
    date: '2026-07-01',
    endpoints: { caloriesTrend: { 'activities-calories': [{ dateTime: '2026-06-30', value: 2222 }] } },
  }, '2026-07-01')
  assert.equal(calFallback.caloriesOut, 2222)

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
  assert.equal(noCachedDate.steps, 7873)
})
