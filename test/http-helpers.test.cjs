const { test } = require('node:test')
const assert = require('node:assert')
const { parseQuery } = require('../server/http-helpers.cjs')

test('parseQuery reads params', () => {
  const q = parseQuery('http://x/api/exercises?q=push&limit=5')
  assert.equal(q.get('q'), 'push')
  assert.equal(q.get('limit'), '5')
})
