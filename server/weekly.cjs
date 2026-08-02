// Weekly summary + insight text. Pure — takes an array of summary.daySummary(...) results.
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

// Score each goal by how far it actually got, then average the goals we can score.
// Counting whole hits tied constantly: with only steps logged, every day scored exactly 1,
// and a tie made both reduces below fall through to the first element - so bestDay and
// worstDay came back as the same date. Ratios separate 10,279 steps from 18,824; hits cannot.
function goalScore(d, goals) {
  const parts = []
  const calIn = d.nutrition && d.nutrition.calIn
  const protein = d.nutrition && d.nutrition.protein
  const steps = d.health && d.health.steps
  // An unlogged goal reads as 0, which is absence of data, not a failed day - don't score it.
  if (goals?.calorie_goal && calIn) parts.push(Math.max(0, 1 - Math.abs(calIn - goals.calorie_goal) / goals.calorie_goal))
  if (goals?.protein_goal && protein) parts.push(protein / goals.protein_goal)
  if (goals?.steps_goal && steps != null) parts.push(steps / goals.steps_goal)
  return parts.length ? parts.reduce((a, v) => a + v, 0) / parts.length : null
}

function weeklySummary(daySummaries, goals) {
  const n = daySummaries.length
  const withHealth = (pick) => daySummaries.filter((d) => pick(d.health) != null)
  const avg = (nums) => (nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : null)

  // A day with nothing logged is absence of data, not a 0-calorie day. goalScore already refuses
  // to score those; averaging them in dragged avgCalories/avgProtein down by the number of
  // unlogged days (5 logged days out of 7 read as 2490 kcal -> 1778.6). Average over logged days
  // and report how many there were, so the denominator is never silently wrong.
  const loggedDays = daySummaries.filter((d) => d.nutrition && d.nutrition.calIn > 0)
  const avgCalories = round1(avg(loggedDays.map((d) => d.nutrition.calIn)))
  const avgProtein = round1(avg(loggedDays.map((d) => d.nutrition.protein)))
  const nutritionDays = loggedDays.length
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
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
    const worst = scored.reduce((a, b) => (b.score < a.score ? b : a))
    // Every day equal (or only one day) means there is nothing to rank. Naming one date as both
    // best and worst - what the bare reduces did on a tie - is worse than admitting that.
    if (best.score !== worst.score) {
      bestDay = best.date
      worstDay = worst.date
    }
  }

  const insights = []
  if (goals?.protein_goal && nutritionDays) {
    const hit = loggedDays.filter((d) => d.nutrition.protein >= goals.protein_goal).length
    insights.push(`Protein target hit ${hit}/${nutritionDays} logged days`)
  }
  if (nutritionDays < n) insights.push(`${n - nutritionDays}/${n} days had no food logged`)
  if (sleepDays.length) {
    const below6 = sleepDays.filter((d) => d.health.sleepMin < 360).length
    insights.push(`${below6}/${sleepDays.length} days with sleep below 6h`)
  }
  if (goals?.steps_goal && stepsDays.length) {
    const hit = stepsDays.filter((d) => d.health.steps >= goals.steps_goal).length
    insights.push(`Steps target hit ${hit}/${n} days`)
  }

  return { days: n, nutritionDays, avgCalories, avgProtein, workoutCount, avgSteps, avgSleepMin, weightChange, bestDay, worstDay, insights }
}

module.exports = { weeklySummary }
