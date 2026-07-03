// Progressive overload: per-exercise max weight, session volume, PR detection, month-over-month delta.
// Pure — takes whatever db.listWorkouts({}) returns.
const DAY = 86400000
const norm = (name) => String(name || '').trim().toLowerCase()

function computeProgress(workouts) {
  const byName = new Map() // normalized name -> { name, entries[] }
  for (const w of workouts) {
    if (w.weight_kg == null) continue // bodyweight/cardio entries don't track load progression
    const key = norm(w.name)
    if (!byName.has(key)) byName.set(key, { name: w.name, entries: [] })
    byName.get(key).entries.push(w)
  }

  const out = []
  for (const { name, entries } of byName.values()) {
    entries.sort((a, b) => new Date(a.performed_at) - new Date(b.performed_at))
    const maxWeight = Math.max(...entries.map((e) => e.weight_kg))
    const lastPerformed = entries[entries.length - 1].performed_at
    const lastDate = lastPerformed.slice(0, 10)
    const lastSession = entries.filter((e) => e.performed_at.slice(0, 10) === lastDate)
    const lastSessionVolume = lastSession.reduce((a, e) => a + (e.sets || 0) * (e.reps || 0) * (e.weight_kg || 0), 0)
    const sessionMax = Math.max(...lastSession.map((e) => e.weight_kg))
    const priorEntries = entries.filter((e) => e.performed_at.slice(0, 10) !== lastDate)
    const priorMax = priorEntries.length ? Math.max(...priorEntries.map((e) => e.weight_kg)) : 0
    const isPR = sessionMax > priorMax

    const lastMs = new Date(lastPerformed).getTime()
    const monthAgoEntries = entries.filter((e) => {
      const ageDays = (lastMs - new Date(e.performed_at).getTime()) / DAY
      return ageDays >= 23 && ageDays <= 37
    })
    const monthAgoMax = monthAgoEntries.length ? Math.max(...monthAgoEntries.map((e) => e.weight_kg)) : null
    const deltaFromLastMonth = monthAgoMax == null ? null : Math.round((maxWeight - monthAgoMax) * 10) / 10

    out.push({ name, maxWeight, lastPerformed, lastSessionVolume, isPR, deltaFromLastMonth })
  }
  out.sort((a, b) => new Date(b.lastPerformed) - new Date(a.lastPerformed))
  return out
}

module.exports = { computeProgress }
