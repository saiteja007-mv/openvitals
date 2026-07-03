const { test } = require('node:test')
const assert = require('node:assert')
const { computeProgress } = require('../server/progress.cjs')

test('computeProgress: max weight, last session volume, last performed', () => {
  const workouts = [
    { name: 'Bench press', performed_at: '2026-06-01T10:00:00Z', sets: 4, reps: 8, weight_kg: 55 },
    { name: 'Bench press', performed_at: '2026-07-01T10:00:00Z', sets: 4, reps: 8, weight_kg: 60 },
    { name: 'bench press', performed_at: '2026-07-01T10:30:00Z', sets: 1, reps: 5, weight_kg: 62.5 }, // same session, different case
    { name: 'Squat', performed_at: '2026-06-15T10:00:00Z', sets: 3, reps: 5, weight_kg: 100 },
  ]
  const p = computeProgress(workouts)
  const bench = p.find((x) => x.name === 'Bench press')
  assert.equal(bench.maxWeight, 62.5)
  assert.equal(bench.lastPerformed, '2026-07-01T10:30:00Z')
  assert.equal(bench.lastSessionVolume, 4 * 8 * 60 + 1 * 5 * 62.5)
})

test('computeProgress: PR detection requires beating all prior sessions', () => {
  const risingWorkouts = [
    { name: 'Deadlift', performed_at: '2026-05-01T10:00:00Z', sets: 3, reps: 5, weight_kg: 100 },
    { name: 'Deadlift', performed_at: '2026-07-01T10:00:00Z', sets: 3, reps: 5, weight_kg: 120 },
  ]
  assert.equal(computeProgress(risingWorkouts)[0].isPR, true)

  const platWorkouts = [
    { name: 'Deadlift', performed_at: '2026-05-01T10:00:00Z', sets: 3, reps: 5, weight_kg: 120 },
    { name: 'Deadlift', performed_at: '2026-07-01T10:00:00Z', sets: 3, reps: 5, weight_kg: 110 },
  ]
  assert.equal(computeProgress(platWorkouts)[0].isPR, false)
})

test('computeProgress: delta from last month uses the ~23-37 day window, null if no data there', () => {
  const workouts = [
    { name: 'Bench press', performed_at: '2026-06-01T10:00:00Z', sets: 4, reps: 8, weight_kg: 55 }, // ~30d before last
    { name: 'Bench press', performed_at: '2026-07-01T10:00:00Z', sets: 4, reps: 8, weight_kg: 60 },
  ]
  assert.equal(computeProgress(workouts)[0].deltaFromLastMonth, 5)

  const noHistory = [{ name: 'Overhead press', performed_at: '2026-07-01T10:00:00Z', sets: 3, reps: 8, weight_kg: 40 }]
  assert.equal(computeProgress(noHistory)[0].deltaFromLastMonth, null)
})

test('computeProgress: skips entries without a logged weight (bodyweight/cardio)', () => {
  const workouts = [{ name: 'Running', performed_at: '2026-07-01T10:00:00Z', duration_min: 30 }]
  assert.deepEqual(computeProgress(workouts), [])
})
