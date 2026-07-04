const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
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

test('seeded meal recipes include Chicken pulao and do not log meals', () => {
  const recipes = db.listMealRecipes()
  const pulao = recipes.find((r) => r.name === 'Chicken pulao')
  assert.ok(pulao)
  assert.equal(pulao.calories, 680)
  assert.equal(pulao.protein_g, 50)
  assert.equal(pulao.carbs_g, 64)
  assert.equal(pulao.fat_g, 24)
  assert.equal(db.listMeals({}).length, 0)
})

test('meal recipe CRUD round-trip', () => {
  const r = db.createMealRecipe({ name: 'Test bowl', calories: 500, protein_g: 40, carbs_g: 50, fat_g: 10 })
  assert.ok(r.id)
  assert.equal(db.listMealRecipes().some((x) => x.name === 'Test bowl'), true)
  const u = db.updateMealRecipe(r.id, { protein_g: 42 })
  assert.equal(u.protein_g, 42)
  assert.equal(db.deleteMealRecipe(r.id).deleted, true)
})

test('listMeals filters by meal_type and limit ("same as last dinner")', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', meal_type: 'breakfast', calories: 300 })
  db.createMeal({ name: 'Old dinner', eaten_at: '2026-06-30T19:00:00', meal_type: 'dinner', calories: 500 })
  db.createMeal({ name: 'Latest dinner', eaten_at: '2026-07-01T19:00:00', meal_type: 'dinner', calories: 700 })
  const dinners = db.listMeals({ meal_type: 'dinner', limit: 1 })
  assert.equal(dinners.length, 1)
  assert.equal(dinners[0].name, 'Latest dinner')
})

test('duplicateMeals copies a day\'s meals onto another date, preserving time-of-day', () => {
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00.000Z', meal_type: 'breakfast', calories: 300, protein_g: 10 })
  db.createMeal({ name: 'Pulao', eaten_at: '2026-07-01T19:00:00.000Z', meal_type: 'dinner', calories: 680 })
  const created = db.duplicateMeals('2026-07-01', '2026-07-02')
  assert.equal(created.length, 2)
  assert.equal(db.listMeals({ from: '2026-07-02', to: '2026-07-03' }).length, 2)
  const oats = created.find((m) => m.name === 'Oats')
  assert.equal(oats.eaten_at, '2026-07-02T08:00:00.000Z')
})

test('settings singleton: defaults null, updates persist', () => {
  const s0 = db.getSettings()
  assert.ok(s0)
  assert.equal(s0.calorie_goal, null)
  const s1 = db.updateSettings({ calorie_goal: 2200, protein_goal: 150, steps_goal: 10000, sleep_goal_min: 420, weight_goal_kg: 75, height_cm: 178 })
  assert.equal(s1.calorie_goal, 2200)
  assert.equal(s1.protein_goal, 150)
  assert.equal(s1.steps_goal, 10000)
  assert.equal(db.getSettings().height_cm, 178)
})

test('habits: set + get per date, independent per habit', () => {
  assert.deepEqual(db.getHabits('2026-07-01'), {})
  db.setHabit('2026-07-01', 'water', true)
  db.setHabit('2026-07-01', 'creatine', false)
  assert.deepEqual(db.getHabits('2026-07-01'), { water: true, creatine: false })
  db.setHabit('2026-07-01', 'water', false)
  assert.equal(db.getHabits('2026-07-01').water, false)
  assert.deepEqual(db.getHabits('2026-07-02'), {})
})

test('custom habits: definitions, defaults, streaks, and 30/60 day history windows', () => {
  assert.ok(db.listHabits('2026-07-03').some((h) => h.name === 'No sugar'))
  db.createHabit('No soda')
  db.setHabit('2026-07-01', 'No soda', true)
  db.setHabit('2026-07-02', 'No soda', true)
  let habits = db.listHabits('2026-07-03')
  let noSoda = habits.find((h) => h.name === 'No soda')
  assert.equal(noSoda.done, false)
  assert.equal(noSoda.streak, 0) // today (07-03) not logged -> streak counts only explicitly-logged days ending today
  assert.equal(noSoda.history.length, 30)
  assert.equal(noSoda.history.at(-1).date, '2026-07-03')
  assert.equal(noSoda.history.at(-2).done, true)
  db.setHabit('2026-07-03', 'No soda', true)
  noSoda = db.listHabits('2026-07-03').find((h) => h.name === 'No soda')
  assert.equal(noSoda.done, true)
  assert.equal(noSoda.streak, 3)

  db.createHabit('Long run')
  for (let i = 0; i < 31; i++) db.setHabit(new Date(Date.UTC(2026, 6, 3 - i)).toISOString().slice(0, 10), 'Long run', true)
  const longRun = db.listHabits('2026-07-03').find((h) => h.name === 'Long run')
  assert.equal(longRun.streak, 31)
  assert.equal(longRun.history.length, 60)
})

test('setHabit creates a visible custom habit definition', () => {
  db.setHabit('2026-07-01', 'No beverage', true)
  const hb = db.listHabits('2026-07-01').find((h) => h.name === 'No beverage')
  assert.ok(hb)
  assert.equal(hb.done, true)
})

test('body metrics: upsert by date + list + delete', () => {
  const created = db.upsertBodyMetric('2026-07-01', { weight_kg: 80.5, waist_cm: 90 })
  assert.equal(created.weight_kg, 80.5)
  const updated = db.upsertBodyMetric('2026-07-01', { body_fat_pct: 18 })
  assert.equal(updated.id, created.id)
  assert.equal(updated.waist_cm, 90) // untouched by second upsert
  assert.equal(updated.body_fat_pct, 18)
  assert.equal(db.listBodyMetrics({}).length, 1)
  assert.equal(db.deleteBodyMetric(created.id).deleted, true)
})

test('body metric photo: save private file + resolve path, rejects traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consied-test-'))
  db.initDb(path.join(dir, 'test.sqlite'))
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const ref = db.savePhoto(png1x1)
  assert.ok(ref.endsWith('.png'))
  assert.ok(db.photoPath(ref))
  assert.equal(db.photoPath('../../etc/passwd'), null)
  assert.equal(db.photoPath('nope.png'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('workout plans: seeded Push/Pull/Legs + CRUD + items round-trip', () => {
  const plans = db.listWorkoutPlans()
  const names = plans.map((p) => p.name)
  assert.ok(names.includes('Push Day'))
  assert.ok(names.includes('Pull Day'))
  assert.ok(names.includes('Leg Day'))
  assert.ok(Array.isArray(plans[0].items))
  assert.ok(plans.find((p) => p.name === 'Push Day').items.some((i) => i.name === 'Bench press'))

  const created = db.createWorkoutPlan({ name: 'Custom A', kind: 'custom', items: [{ name: 'Curl', target_sets: 3, target_reps: 12 }] })
  assert.equal(created.items.length, 1)
  const updated = db.updateWorkoutPlan(created.id, { items: [{ name: 'Curl', target_sets: 4, target_reps: 10 }] })
  assert.equal(updated.items[0].target_sets, 4)
  assert.equal(db.deleteWorkoutPlan(created.id).deleted, true)
})

test('workouts can reference a plan_id (progressive overload / plan compare join)', () => {
  const plan = db.listWorkoutPlans()[0]
  const w = db.createWorkout({ name: 'Bench press', performed_at: '2026-07-01T10:00:00', sets: 4, reps: 8, weight_kg: 60, plan_id: plan.id })
  assert.equal(w.plan_id, plan.id)
})

test('reminders: CRUD + due-check log', () => {
  const r = db.createReminder({ kind: 'water', channel: 'slack', enabled: 1, time_of_day: '09:00' })
  assert.ok(r.id)
  assert.equal(db.listReminders().length, 1)
  db.logReminderAttempt(r.id, '2026-07-01', 'skipped_not_configured', 'no webhook set')
  assert.equal(db.reminderLogFor('2026-07-01')[0].status, 'skipped_not_configured')
  const u = db.updateReminder(r.id, { enabled: 0 })
  assert.equal(u.enabled, 0)
  assert.equal(db.deleteReminder(r.id).deleted, true)
})

test('export/import round-trip preserves data and excludes reminders', () => {
  db.createWorkout({ name: 'Squat', performed_at: '2026-07-01T10:00:00', sets: 3, reps: 5, weight_kg: 60 })
  db.createMeal({ name: 'Oats', eaten_at: '2026-07-01T08:00:00', calories: 300 })
  db.updateSettings({ calorie_goal: 2200 })
  db.createReminder({ kind: 'water', channel: 'slack', target: 'https://hooks.slack.example/secret' })
  const dump = db.exportAll()
  assert.ok(!('reminders' in dump))
  assert.equal(dump.workouts.length, 1)

  db.initDb(':memory:') // fresh db to prove import restores state, not a no-op
  const res = db.importAll(dump)
  assert.ok(res.restored.includes('workouts'))
  assert.equal(db.listWorkouts({}).length, 1)
  assert.equal(db.getSettings().calorie_goal, 2200)
})
