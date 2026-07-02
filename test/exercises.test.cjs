const { test, before } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const ex = require('../server/exercises.cjs')

before(() => ex.loadExercises(path.join(__dirname, '..', 'data', 'exercises.json')))

test('loads full catalog', () => {
  assert.equal(ex.searchExercises({}).total, 1324)
})

test('search by name substring', () => {
  const r = ex.searchExercises({ q: 'sit-up' })
  assert.ok(r.total >= 1)
  assert.ok(r.items[0].name.toLowerCase().includes('sit-up'))
})

test('filter by bodyPart + facets', () => {
  const f = ex.facets()
  assert.ok(f.bodyParts.length > 3)
  const r = ex.searchExercises({ bodyPart: f.bodyParts[0], limit: 5 })
  assert.ok(r.items.every((e) => e.body_part === f.bodyParts[0]))
})

test('getExercise by id', () => {
  assert.equal(ex.getExercise('0001').name, '3/4 sit-up')
})
