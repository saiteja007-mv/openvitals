// Smart calorie/protein recommendation. Advisory only — not medical advice.
const KCAL_PER_KG_FAT = 7700
const LOSE_RATE_KG_PER_WEEK = 0.5
const GAIN_RATE_KG_PER_WEEK = 0.35

function recommend({ weightSeries, avgCaloriesIn, avgCaloriesOut, currentWeightKg, goalWeightKg }) {
  const flags = []

  let weeklyDeltaKg = null
  if (Array.isArray(weightSeries) && weightSeries.length >= 2) {
    const first = weightSeries[0]
    const last = weightSeries[weightSeries.length - 1]
    const days = (new Date(last.date) - new Date(first.date)) / 86400000
    if (days >= 5) weeklyDeltaKg = Math.round(((last.value - first.value) / days) * 7 * 100) / 100
  }

  const impliedDeficit = (avgCaloriesOut != null && avgCaloriesIn != null) ? Math.round(avgCaloriesOut - avgCaloriesIn) : null
  if (impliedDeficit != null && impliedDeficit > 1100) flags.push('Deficit looks too high (>1kg/week pace) — consider eating more to protect muscle and energy.')
  if (impliedDeficit != null && impliedDeficit < -1000) flags.push('Large surplus (>1kg/week gain pace) — consider trimming intake if the goal is lean gain.')
  if (weeklyDeltaKg != null && weeklyDeltaKg < -1) flags.push('Losing weight faster than 1kg/week — likely too aggressive a deficit.')

  let direction = 'maintain'
  if (goalWeightKg != null && currentWeightKg != null) {
    if (goalWeightKg < currentWeightKg - 0.5) direction = 'lose'
    else if (goalWeightKg > currentWeightKg + 0.5) direction = 'gain'
  }

  const baseline = avgCaloriesOut ?? avgCaloriesIn ?? null
  let targetCalories = null
  if (baseline != null) {
    const adjust = direction === 'lose' ? -Math.round((LOSE_RATE_KG_PER_WEEK * KCAL_PER_KG_FAT) / 7)
      : direction === 'gain' ? Math.round((GAIN_RATE_KG_PER_WEEK * KCAL_PER_KG_FAT) / 7)
      : 0
    targetCalories = Math.round(baseline + adjust)
  }

  const proteinRangeG = currentWeightKg != null ? [Math.round(1.6 * currentWeightKg), Math.round(2.2 * currentWeightKg)] : null

  const messages = []
  if (direction === 'lose') messages.push(`Aim for ~${targetCalories ?? '—'} kcal/day for ~${LOSE_RATE_KG_PER_WEEK}kg/week loss.`)
  else if (direction === 'gain') messages.push(`Aim for ~${targetCalories ?? '—'} kcal/day for gradual lean gain.`)
  else if (targetCalories != null) messages.push(`~${targetCalories} kcal/day looks about right to maintain.`)
  if (proteinRangeG) messages.push(`Protein target range: ${proteinRangeG[0]}–${proteinRangeG[1]}g/day.`)

  return {
    direction, weeklyDeltaKg, impliedDeficit, targetCalories, proteinRangeG, flags,
    message: messages.join(' '),
    disclaimer: 'Advisory only, not medical advice.',
  }
}

module.exports = { recommend }
