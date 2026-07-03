const { test } = require('node:test')
const assert = require('node:assert')
const { recommend } = require('../server/recommend.cjs')

test('recommend: lose direction targets ~550 kcal/day deficit from caloriesOut baseline', () => {
  const r = recommend({ weightSeries: [], avgCaloriesIn: 2200, avgCaloriesOut: 2600, currentWeightKg: 90, goalWeightKg: 80 })
  assert.equal(r.direction, 'lose')
  assert.equal(r.targetCalories, 2600 - 550)
  assert.deepEqual(r.proteinRangeG, [144, 198])
  assert.equal(r.impliedDeficit, 400)
})

test('recommend: flags deficit that is too aggressive', () => {
  const r = recommend({ avgCaloriesIn: 1400, avgCaloriesOut: 2700, currentWeightKg: 90, goalWeightKg: 80 })
  assert.ok(r.flags.some((f) => /too high/i.test(f)))
})

test('recommend: flags weight loss faster than 1kg/week from actual weight trend', () => {
  const weightSeries = [{ date: '2026-06-01', value: 90 }, { date: '2026-06-15', value: 87.5 }]
  const r = recommend({ weightSeries, avgCaloriesIn: 2000, avgCaloriesOut: 2200, currentWeightKg: 87.5, goalWeightKg: 80 })
  assert.equal(r.weeklyDeltaKg, -1.25)
  assert.ok(r.flags.some((f) => /faster than 1kg/i.test(f)))
})

test('recommend: maintain direction when no goal weight given', () => {
  const r = recommend({ avgCaloriesIn: 2200, avgCaloriesOut: 2200, currentWeightKg: 80 })
  assert.equal(r.direction, 'maintain')
  assert.equal(r.targetCalories, 2200)
})

test('recommend: always carries the advisory disclaimer', () => {
  assert.match(recommend({}).disclaimer, /not medical advice/i)
})
