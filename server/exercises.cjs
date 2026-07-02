const fs = require('node:fs')

let all = []

function loadExercises(jsonPath) {
  all = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  return all.length
}

function searchExercises({ q, bodyPart, equipment, target, limit = 50, offset = 0 } = {}) {
  const ql = q ? String(q).toLowerCase() : null
  const m = all.filter((e) =>
    (!ql || e.name.toLowerCase().includes(ql)) &&
    (!bodyPart || e.body_part === bodyPart) &&
    (!equipment || e.equipment === equipment) &&
    (!target || e.target === target))
  return { total: m.length, items: m.slice(Number(offset), Number(offset) + Number(limit)) }
}

function getExercise(id) {
  return all.find((e) => e.id === id) || null
}

function uniq(key) {
  return [...new Set(all.map((e) => e[key]).filter(Boolean))].sort()
}

function facets() {
  return { bodyParts: uniq('body_part'), equipment: uniq('equipment'), targets: uniq('target') }
}

module.exports = { loadExercises, searchExercises, getExercise, facets }
