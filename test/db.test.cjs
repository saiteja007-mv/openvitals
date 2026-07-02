const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const db = require('../server/db.cjs')

beforeEach(() => { db.initDb(':memory:') })

test('workout CRUD round-trip', () => {
  const w = db.createWorkout({ name: 'Squat', performed_at: '2026-07-01T10:00:00', sets: 3, reps: 5, weight_kg: 60 })
  assert.ok(w.id)
  assert.equal(w.name, 'Squat')
  assert.equal(db.listWorkouts({}).length, 1)
  const u = db.updateWorkout(w.id, { reps: 8 })
  assert.equal(u.reps, 8)
  assert.equal(db.deleteWorkout(w.id).deleted, true)
  assert.equal(db.listWorkouts({}).length, 0)
})

test('meal CRUD + date filter', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300, protein_g: 10 })
  db.createMeal({ name: 'Old', eaten_at: '2026-06-01T08:00:00', calories: 100 })
  assert.equal(db.listMeals({ from: '2026-07-01', to: '2026-07-02' }).length, 1)
})
