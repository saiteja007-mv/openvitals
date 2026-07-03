// Weekly summary + insight text. Pure — takes an array of summary.daySummary(...) results.
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

function goalScore(d, goals) {
  let hits = 0
  let scored = false
  if (goals?.calorie_goal) { scored = true; if (Math.abs(d.nutrition.calIn - goals.calorie_goal) <= goals.calorie_goal * 0.1) hits++ }
  if (goals?.protein_goal) { scored = true; if (d.nutrition.protein >= goals.protein_goal) hits++ }
  if (goals?.steps_goal && d.health.steps != null) { scored = true; if (d.health.steps >= goals.steps_goal) hits++ }
  return scored ? hits : null
}

function weeklySummary(daySummaries, goals) {
  const n = daySummaries.length
  const withHealth = (pick) => daySummaries.filter((d) => pick(d.health) != null)
  const avg = (nums) => (nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : null)

  const avgCalories = round1(avg(daySummaries.map((d) => d.nutrition.calIn)))
  const avgProtein = round1(avg(daySummaries.map((d) => d.nutrition.protein)))
  const workoutCount = daySummaries.reduce((a, d) => a + d.workouts.length, 0)

  const stepsDays = withHealth((h) => h.steps)
  const avgSteps = stepsDays.length ? Math.round(avg(stepsDays.map((d) => d.health.steps))) : null
  const sleepDays = withHealth((h) => h.sleepMin)
  const avgSleepMin = sleepDays.length ? Math.round(avg(sleepDays.map((d) => d.health.sleepMin))) : null
  const weightDays = withHealth((h) => h.weightKg)
  const weightChange = weightDays.length >= 2
    ? round1(weightDays[weightDays.length - 1].health.weightKg - weightDays[0].health.weightKg)
    : null

  const scored = daySummaries
    .map((d) => ({ date: d.date, score: goalScore(d, goals) }))
    .filter((d) => d.score != null)
  let bestDay = null, worstDay = null
  if (scored.length) {
    bestDay = scored.reduce((a, b) => (b.score > a.score ? b : a)).date
    worstDay = scored.reduce((a, b) => (b.score < a.score ? b : a)).date
  }

  const insights = []
  if (goals?.protein_goal) {
    const hit = daySummaries.filter((d) => d.nutrition.protein >= goals.protein_goal).length
    insights.push(`Protein target hit ${hit}/${n} days`)
  }
  if (sleepDays.length) {
    const below6 = sleepDays.filter((d) => d.health.sleepMin < 360).length
    insights.push(`${below6}/${sleepDays.length} days with sleep below 6h`)
  }
  if (goals?.steps_goal && stepsDays.length) {
    const hit = stepsDays.filter((d) => d.health.steps >= goals.steps_goal).length
    insights.push(`Steps target hit ${hit}/${n} days`)
  }

  return { days: n, avgCalories, avgProtein, workoutCount, avgSteps, avgSleepMin, weightChange, bestDay, worstDay, insights }
}

module.exports = { weeklySummary }
