const { test } = require('node:test')
const assert = require('node:assert')
const { weeklySummary } = require('../server/weekly.cjs')

function day(date, { calIn, protein, steps, sleepMin, weightKg, workouts = 0 }) {
  return {
    date,
    health: { steps: steps ?? null, sleepMin: sleepMin ?? null, weightKg: weightKg ?? null },
    workouts: Array.from({ length: workouts }, (_, i) => ({ id: i })),
    meals: [],
    nutrition: { calIn, protein, carbs: 0, fat: 0 },
    balance: { in: calIn, out: 0, net: calIn },
  }
}

test('weeklySummary: averages, workout count, weight change', () => {
  const days = [
    day('2026-06-25', { calIn: 2000, protein: 140, steps: 8000, sleepMin: 400, weightKg: 80, workouts: 1 }),
    day('2026-06-26', { calIn: 2200, protein: 160, steps: 12000, sleepMin: 300, weightKg: 79.5, workouts: 0 }),
  ]
  const s = weeklySummary(days, { calorie_goal: 2100, protein_goal: 150, steps_goal: 10000 })
  assert.equal(s.days, 2)
  assert.equal(s.avgCalories, 2100)
  assert.equal(s.avgProtein, 150)
  assert.equal(s.workoutCount, 1)
  assert.equal(s.avgSteps, 10000)
  assert.equal(s.avgSleepMin, 350)
  assert.equal(s.weightChange, -0.5)
})

test('weeklySummary: best/worst day by goals-hit score', () => {
  const days = [
    day('2026-06-25', { calIn: 2100, protein: 160, steps: 11000 }), // hits all 3
    day('2026-06-26', { calIn: 3000, protein: 80, steps: 2000 }),   // hits none
  ]
  const s = weeklySummary(days, { calorie_goal: 2100, protein_goal: 150, steps_goal: 10000 })
  assert.equal(s.bestDay, '2026-06-25')
  assert.equal(s.worstDay, '2026-06-26')
})

test('weeklySummary: insight strings for protein target + sleep below 6h', () => {
  const days = [
    day('2026-06-25', { calIn: 2000, protein: 160, sleepMin: 300 }), // below 6h, protein hit
    day('2026-06-26', { calIn: 2000, protein: 100, sleepMin: 420 }), // above 6h, protein missed
  ]
  const s = weeklySummary(days, { protein_goal: 150 })
  assert.ok(s.insights.includes('Protein target hit 1/2 days'))
  assert.ok(s.insights.includes('1/2 days with sleep below 6h'))
})

test('weeklySummary: handles missing goals/health gracefully', () => {
  const s = weeklySummary([day('2026-06-25', { calIn: 2000, protein: 100 })], {})
  assert.equal(s.bestDay, null)
  assert.equal(s.avgSteps, null)
  assert.deepEqual(s.insights, [])
})

test('weeklySummary: ranks by degree, not whole hits, when only one goal has data', () => {
  // Real case: nothing logged by hand, so steps is the only scoreable goal and every day
  // clears it. Hit-counting tied every day at 1 and returned the first date as BOTH
  // best and worst. Degree of achievement must still separate them.
  const days = [
    day('2026-07-13', { calIn: 0, protein: 0, steps: 10610 }),
    day('2026-07-14', { calIn: 0, protein: 0, steps: 10279 }),
    day('2026-07-15', { calIn: 0, protein: 0, steps: 11336 }),
    day('2026-07-16', { calIn: 0, protein: 0, steps: 18824 }),
  ]
  const s = weeklySummary(days, { calorie_goal: 2200, protein_goal: 120, steps_goal: 10000 })
  assert.equal(s.bestDay, '2026-07-16')
  assert.equal(s.worstDay, '2026-07-14')
  assert.notEqual(s.bestDay, s.worstDay)
})

test('weeklySummary: identical days rank as neither best nor worst', () => {
  const days = [
    day('2026-07-13', { calIn: 2200, protein: 120, steps: 11000 }),
    day('2026-07-14', { calIn: 2200, protein: 120, steps: 11000 }),
  ]
  const s = weeklySummary(days, { calorie_goal: 2200, protein_goal: 120, steps_goal: 10000 })
  assert.equal(s.bestDay, null, 'a genuine tie must not name a best day')
  assert.equal(s.worstDay, null, 'a genuine tie must not name a worst day')
})
