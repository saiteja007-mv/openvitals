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

test('extractHealthMetrics reads activity.summary', () => {
  const cached = { endpoints: { activity: { summary: { steps: 8000, caloriesOut: 2200 } } } }
  const h = s.extractHealthMetrics(cached, '2026-07-01')
  assert.equal(h.steps, 8000)
  assert.equal(h.caloriesOut, 2200)
})
