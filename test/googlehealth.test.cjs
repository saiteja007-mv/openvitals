const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// openfit.cjs now calls the Google Health API directly (no :42813 backend). We mock the
// google-health-service via the test hook so this stays offline.
test('getHealth pulls Google Health, caches last good, degrades to stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-mcp-gh-'))
  const secrets = path.join(dir, 'secrets.json')
  const creds = path.join(dir, 'creds.json')
  fs.writeFileSync(secrets, JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }))
  fs.writeFileSync(creds, JSON.stringify({ token: { access_token: 'a', refresh_token: 'r', expiresAt: Date.now() + 3_600_000 } }))
  process.env.GOOGLE_HEALTH_SECRETS = secrets
  process.env.HEALTH_MCP_GH_CREDENTIALS = creds
  process.env.HEALTH_MCP_HEALTH_TTL_MS = '0' // disable the pull cache so the stale-degrade path is exercised
  delete require.cache[require.resolve('../server/googlehealth.cjs')]
  const of = require('../server/googlehealth.cjs')

  let good = true
  of.__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    syncData: async () => { if (!good) throw new Error('boom'); return { source: 'google-health', date: '2026-07-01', requestStats: { total: 10, succeeded: 10 } } },
  })

  let h = await of.getHealth()
  assert.equal(h.stale, false)
  assert.equal(h.data.source, 'google-health')

  good = false
  h = await of.getHealth()
  assert.equal(h.stale, true)
  assert.equal(h.data.date, '2026-07-01') // last good preserved

  const st = await of.getStatus()
  assert.equal(st.connected, true)
})

// ===== local day cache: the whole point is that a past date costs zero API calls =====

const dbMod = require('../server/db.cjs')

function ghFixture({ onSync } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-mcp-ghcache-'))
  const secrets = path.join(dir, 'secrets.json')
  const creds = path.join(dir, 'creds.json')
  fs.writeFileSync(secrets, JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }))
  fs.writeFileSync(creds, JSON.stringify({ token: { access_token: 'a', refresh_token: 'r', expiresAt: Date.now() + 3_600_000 } }))
  process.env.GOOGLE_HEALTH_SECRETS = secrets
  process.env.HEALTH_MCP_GH_CREDENTIALS = creds
  process.env.HEALTH_MCP_HEALTH_TTL_MS = '0'
  dbMod.initDb(':memory:')
  delete require.cache[require.resolve('../server/googlehealth.cjs')]
  const gh = require('../server/googlehealth.cjs')
  const calls = []
  gh.__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    syncData: async (_t, date) => {
      calls.push(date)
      if (onSync) return onSync(date)
      return {
        source: 'google-health', date, requestStats: { total: 10, succeeded: 10 },
        endpoints: { activity: { summary: { steps: 1234 } }, heartIntraday: { huge: 'x'.repeat(5000) } },
      }
    },
  })
  return { gh, calls }
}

const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` }

test('a past date is served from the local cache without calling Google', async () => {
  const { gh, calls } = ghFixture()
  const first = await gh.getHealth('2026-07-01')
  assert.equal(first.cached, false, 'first read must go live — nothing is cached yet')
  assert.equal(calls.length, 1)

  const second = await gh.getHealth('2026-07-01')
  assert.equal(second.cached, true, 'second read must come from disk')
  assert.equal(second.data.endpoints.activity.summary.steps, 1234)
  assert.equal(calls.length, 1, 'no second API call may be made for a finished day')
})

test('today always goes live even once cached, because today is still accumulating', async () => {
  const { gh, calls } = ghFixture()
  await gh.getHealth(todayIso())
  await gh.getHealth(todayIso())
  assert.equal(calls.length, 2)
})

test('intraday series are not cached — they are the bulk of the payload and nothing queries them', async () => {
  const { gh } = ghFixture()
  await gh.getHealth('2026-07-04')
  const day = dbMod.getDailyHealth('2026-07-04')
  assert.ok(day.endpoints.activity, 'day-level data is kept')
  assert.equal(day.endpoints.heartIntraday, undefined, 'intraday is deliberately dropped')
})

test('backfill fetches missing days, skips cached ones, and never asks for the future', async () => {
  const { gh, calls } = ghFixture()
  dbMod.cacheDailyHealth('2026-07-02', { activity: { summary: { steps: 1 } } })

  const r = await gh.backfill('2026-07-01', '2026-07-04', { pauseMs: 0 })
  assert.equal(r.fetched, 2, '07-01 and 07-03 are missing')
  assert.equal(r.skipped, 1, '07-02 was already cached')
  assert.deepEqual(calls.sort(), ['2026-07-01', '2026-07-03'])
  assert.equal(r.failed.length, 0)

  const future = await gh.backfill('2099-01-01', '2099-01-05', { pauseMs: 0 })
  assert.equal(future.total, 0, 'dates after today are not requestable')
})

test('backfill records a failed day and keeps going instead of aborting the range', async () => {
  const { gh } = ghFixture({
    onSync: (date) => {
      if (date === '2026-07-06') throw new Error('rate limited')
      return { source: 'google-health', date, requestStats: { total: 10, succeeded: 10 }, endpoints: { activity: { summary: { steps: 7 } } } }
    },
  })
  const r = await gh.backfill('2026-07-05', '2026-07-08', { pauseMs: 0 })
  assert.equal(r.fetched, 2)
  assert.equal(r.failed.length, 1)
  assert.equal(r.failed[0].date, '2026-07-06')
  assert.match(r.failed[0].error, /rate limited/)
  assert.ok(dbMod.getDailyHealth('2026-07-07'), 'the day after the failure still got cached')
})

test('a past date with no cache and Google down reports stale rather than inventing data', async () => {
  const { gh } = ghFixture({ onSync: () => { throw new Error('offline') } })
  const h = await gh.getHealth('2026-06-15')
  assert.equal(h.stale, true)
  assert.equal(h.data, null, 'no cache and no API means no data, not today\'s data')
})

// ===== Google Health v4 expansion: exercise sessions, nutrition detail, generic query =====
// Fixtures are lifted verbatim from live probes of this account (2026-09-02).

const svc = require('../server/google-health-service.cjs')

const WORKOUT = { dataPointName: 'users/6576655628228310145/dataTypes/exercise/dataPoints/717784651129393176', exercise: { interval: { startTime: '2026-09-02T23:16:38Z', startUtcOffset: '-18000s', endTime: '2026-09-03T00:09:02.016077042Z', endUtcOffset: '-18000s' }, exerciseType: 'WORKOUT', metricsSummary: { caloriesKcal: 133, averageHeartRateBeatsPerMinute: '87', activeZoneMinutes: '1', heartRateZoneDurations: { lightTime: '3120s', moderateTime: '60s', vigorousTime: '0s', peakTime: '0s' } }, exerciseMetadata: {}, displayName: 'Back', activeDuration: '2606s', exerciseEvents: [{ eventTime: '2026-09-02T23:16:38Z', eventUtcOffset: '-18000s', exerciseEventType: 'START' }, { eventTime: '2026-09-02T23:37:01Z', eventUtcOffset: '-18000s', exerciseEventType: 'PAUSE' }, { eventTime: '2026-09-02T23:37:09Z', eventUtcOffset: '-18000s', exerciseEventType: 'RESUME' }, { eventTime: '2026-09-02T23:37:11Z', eventUtcOffset: '-18000s', exerciseEventType: 'PAUSE' }, { eventTime: '2026-09-02T23:37:32Z', eventUtcOffset: '-18000s', exerciseEventType: 'RESUME' }, { eventTime: '2026-09-02T23:38:03Z', eventUtcOffset: '-18000s', exerciseEventType: 'PAUSE' }, { eventTime: '2026-09-02T23:46:32Z', eventUtcOffset: '-18000s', exerciseEventType: 'RESUME' }, { eventTime: '2026-09-03T00:09:00Z', eventUtcOffset: '-18000s', exerciseEventType: 'STOP' }], updateTime: '2026-09-03T00:09:07.598223Z', createTime: '2026-09-02T23:16:42.777744Z' } }
const WALKING = { dataPointName: 'users/6576655628228310145/dataTypes/exercise/dataPoints/7488560355854029872', exercise: { interval: { startTime: '2026-09-03T00:11:05Z', startUtcOffset: '-18000s', endTime: '2026-09-03T00:27:46.808988094Z', endUtcOffset: '-18000s' }, exerciseType: 'WALKING', metricsSummary: { caloriesKcal: 92, distanceMillimeters: 729900, steps: '1219', averagePaceSecondsPerMeter: 1.3659405397999727, averageHeartRateBeatsPerMinute: '88', heartRateZoneDurations: { lightTime: '960s', moderateTime: '0s', vigorousTime: '0s', peakTime: '0s' } }, exerciseMetadata: { hasGps: true }, displayName: 'Walk', activeDuration: '997s', exerciseEvents: [{ eventTime: '2026-09-03T00:11:05Z', eventUtcOffset: '-18000s', exerciseEventType: 'START' }, { eventTime: '2026-09-03T00:27:43Z', eventUtcOffset: '-18000s', exerciseEventType: 'PAUSE' }], updateTime: '2026-09-03T00:27:49.119938Z', createTime: '2026-09-03T00:17:13.796181Z' } }
const NUT_ITEM = { dataPointName: 'users/6576655628228310145/dataTypes/nutrition-log/dataPoints/8912564918741605680', nutritionLog: { interval: { startTime: '2026-09-01T22:16:43.305145Z', startUtcOffset: '-18000s', endTime: '2026-09-01T22:17:43.305145Z', endUtcOffset: '-18000s', civilStartTime: { date: { year: 2026, month: 9, day: 1 }, time: { hours: 17, minutes: 16, seconds: 43, nanos: 305145000 } } }, nutrients: [{ quantity: { grams: 0.30000001192092896 }, nutrient: 'CALCIUM' }, { quantity: { grams: 12 }, nutrient: 'CARBOHYDRATES' }, { quantity: { grams: 0.125 }, nutrient: 'SODIUM' }, { quantity: { grams: 8 }, nutrient: 'PROTEIN' }, { quantity: { grams: 12 }, nutrient: 'SUGAR' }, { quantity: { grams: 0.0024000000953674316 }, nutrient: 'VITAMIN_C' }, { quantity: { grams: 0.005 }, nutrient: 'CHOLESTEROL' }, { quantity: { grams: 0.00015000000596046448 }, nutrient: 'VITAMIN_A' }], energy: { kcal: 80 }, energyFromFat: { kcal: 0 }, totalCarbohydrate: { grams: 12 }, totalFat: { grams: 0 }, mealType: 'BREAKFAST', serving: { amount: 0.25, foodMeasurementUnitDisplayName: 'quart' }, food: 'users/me/dataTypes/food/dataPoints/14740568', foodDisplayName: 'Fat Free Milk' } }
const NUT_ROLLUP = { civilStartTime: { date: { year: 2026, month: 9, day: 1 } }, nutritionLog: { energy: { kcalSum: 80 }, totalCarbohydrate: { gramsSum: 12 }, totalFat: { gramsSum: 0 }, nutrients: [{ nutrient: 'PROTEIN', quantity: { gramsSum: 8 } }, { nutrient: 'SATURATED_FAT', quantity: { gramsSum: 0.5 } }, { nutrient: 'CHOLESTEROL', quantity: { gramsSum: 0.005 } }, { nutrient: 'CALCIUM', quantity: { gramsSum: 0.3 } }] } }
const HRZ = { dailyHeartRateZones: { date: { year: 2026, month: 9, day: 2 }, heartRateZones: [{ heartRateZoneType: 'LIGHT', minBeatsPerMinute: '30', maxBeatsPerMinute: '112' }, { heartRateZoneType: 'MODERATE', minBeatsPerMinute: '113', maxBeatsPerMinute: '139' }, { heartRateZoneType: 'VIGOROUS', minBeatsPerMinute: '140', maxBeatsPerMinute: '173' }, { heartRateZoneType: 'PEAK', minBeatsPerMinute: '174', maxBeatsPerMinute: '220' }] } }
const RRSS = { dataPointName: 'users/6576655628228310145/dataTypes/respiratory-rate-sleep-summary/dataPoints/', respiratoryRateSleepSummary: { sampleTime: { physicalTime: '2026-09-01T08:10:00Z', utcOffset: '-18000s', civilTime: { date: { year: 2026, month: 9, day: 1 }, time: { hours: 3, minutes: 10 } } }, deepSleepStats: { breathsPerMinute: 18.4, standardDeviation: 1, signalToNoise: 9.4 }, lightSleepStats: { breathsPerMinute: 17.6, standardDeviation: 1.2, signalToNoise: 8.3 }, remSleepStats: { breathsPerMinute: 18, standardDeviation: 2.2, signalToNoise: 3.6 }, fullSleepStats: { breathsPerMinute: 18.4, standardDeviation: 1, signalToNoise: 9.4 } } }

// Stub global fetch: `route(url, init)` returns a body (object → JSON, string → text). Records every URL.
async function withFetch(route, fn) {
  const real = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url, init) => {
    urls.push(String(url))
    const body = route(String(url), init)
    return typeof body === 'string'
      ? new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.garmin.tcx+xml' } })
      : Response.json(body)
  }
  try { return await fn(urls) } finally { globalThis.fetch = real }
}

test('fetchExerciseSessions translates a WORKOUT (muscle group, no sets) and a GPS walk', async () => {
  const { sessions } = await withFetch(() => ({ dataPoints: [WORKOUT, WALKING] }), async (urls) => {
    const out = await svc.fetchExerciseSessions('tok', '2026-09-01', '2026-09-03')
    assert.equal(urls.length, 1)
    const u = new URL(urls[0])
    assert.match(u.pathname, /\/exercise\/dataPoints:reconcile$/)
    assert.equal(u.searchParams.get('pageSize'), '25')
    assert.equal(u.searchParams.get('dataSourceFamily'), 'users/me/dataSourceFamilies/all-sources')
    assert.equal(u.searchParams.get('filter'), 'exercise.interval.civil_start_time >= "2026-09-01" AND exercise.interval.civil_start_time < "2026-09-03"')
    return out
  })
  assert.equal(sessions.length, 2)
  const [back, walk] = sessions
  assert.equal(back.session_id, WORKOUT.dataPointName)
  assert.equal(back.exercise_type, 'WORKOUT')
  assert.equal(back.name, 'Back', 'strength sessions are named by muscle group only')
  assert.equal(back.date, '2026-09-02', 'civil date = UTC start + utc offset (-5h), not the UTC date')
  assert.equal(back.utc_offset_s, -18000)
  assert.equal(back.active_duration_s, 2606)
  assert.equal(back.calories_kcal, 133)
  assert.equal(back.avg_hr_bpm, 87, 'string "87" → number')
  assert.equal(back.active_zone_minutes, 1)
  assert.deepEqual(back.hr_zones_min, { light: 52, moderate: 1, vigorous: 0, peak: 0 })
  assert.equal(back.pauses, 3)
  assert.equal(back.events.length, 8)
  assert.deepEqual(back.events[1], { time: '2026-09-02T23:37:01Z', type: 'PAUSE' })
  assert.equal(back.distance_m, null)
  assert.equal(back.steps, null)
  assert.equal(back.has_gps, false)
  assert.equal(back.source, null, 'reconcile does not return dataSource')
  assert.deepEqual(back.laps, [])
  assert.deepEqual(back.raw, WORKOUT.exercise)

  assert.equal(walk.date, '2026-09-02', '00:11Z on 09-03 is 19:11 local on 09-02')
  assert.equal(walk.active_duration_s, 997)
  assert.ok(Math.abs(walk.elapsed_s - 1001.809) < 0.01)
  assert.equal(walk.distance_m, 729.9, 'millimeters → meters')
  assert.equal(walk.steps, 1219)
  assert.equal(walk.avg_pace_s_per_m, 1.3659405397999727)
  assert.equal(walk.has_gps, true)
  assert.equal(walk.pauses, 0) // terminal PAUSE with no RESUME — session-end marker, not a real pause
  for (const v of Object.values(walk)) assert.ok(!Number.isNaN(v), 'never NaN')
})

test('fetchExerciseSession GETs the point on the me alias and keeps dataSource (reconcile drops it)', async () => {
  // dataPoints.get shape from probe2: `name` instead of dataPointName, plus dataSource
  const point = { name: WALKING.dataPointName, dataSource: { recordingMethod: 'ACTIVELY_MEASURED', device: { formFactor: 'FITNESS_BAND', displayName: 'Google Fitbit Air' }, platform: 'FITBIT' }, exercise: WALKING.exercise }
  await withFetch(() => point, async (urls) => {
    const out = await svc.fetchExerciseSession('tok', WALKING.dataPointName)
    assert.equal(urls[0], 'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints/7488560355854029872')
    assert.equal(out.session_id, WALKING.dataPointName)
    assert.deepEqual(out.source, { platform: 'FITBIT', recording_method: 'ACTIVELY_MEASURED' })
    assert.equal(out.steps, 1219)
  })
})

test('exportExerciseTcx GETs alt=media on the me alias and returns the XML text', async () => {
  const xml = '<?xml version="1.0"?><TrainingCenterDatabase/>'
  await withFetch(() => xml, async (urls) => {
    const out = await svc.exportExerciseTcx('tok', WALKING.dataPointName)
    assert.equal(out, xml)
    assert.equal(urls[0], 'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints/7488560355854029872:exportExerciseTcx?alt=media')
  })
})

test('fetchNutritionLog keeps the old shape and adds serving, energy_from_fat, micros and the full nutrient map', async () => {
  const { daily, items } = await withFetch((url) => url.includes('dailyRollUp') ? { rollupDataPoints: [NUT_ROLLUP] } : { dataPoints: [NUT_ITEM] },
    () => svc.fetchNutritionLog('tok', '2026-09-01', '2026-09-02'))
  const [it] = items
  assert.equal(it.food_name, 'Fat Free Milk')
  assert.equal(it.meal_type, 'BREAKFAST')
  assert.equal(it.eaten_at, '2026-09-01T17:16:43')
  assert.deepEqual([it.calories, it.protein, it.carbs, it.fat], [80, 8, 12, 0], 'existing fields unchanged')
  assert.equal(it.serving_amount, 0.25)
  assert.equal(it.serving_unit, 'quart')
  assert.equal(it.energy_from_fat, 0)
  assert.equal(it.sugar, 12)
  assert.equal(it.sodium, 0.125)
  assert.equal(it.cholesterol, 0.005)
  assert.equal(it.fiber, null)
  assert.equal(it.saturated_fat, null)
  assert.equal(it.food_ref, 'users/me/dataTypes/food/dataPoints/14740568')
  assert.deepEqual(Object.keys(it.nutrients).sort(), ['CALCIUM', 'CARBOHYDRATES', 'CHOLESTEROL', 'PROTEIN', 'SODIUM', 'SUGAR', 'VITAMIN_A', 'VITAMIN_C'])
  assert.equal(it.nutrients.VITAMIN_C, 0.0024000000953674316)

  const [d] = daily
  assert.equal(d.date, '2026-09-01')
  assert.deepEqual([d.calories, d.protein, d.carbs, d.fat], [80, 8, 12, 0])
  assert.equal(d.saturated_fat, 0.5)
  assert.equal(d.cholesterol, 0.005)
  assert.deepEqual(d.nutrients, { PROTEIN: 8, SATURATED_FAT: 0.5, CHOLESTEROL: 0.005, CALCIUM: 0.3, CARBOHYDRATES: 12, SODIUM: 0.125, SUGAR: 12, VITAMIN_A: 0.00015000000596046448, VITAMIN_C: 0.0024000000953674316 }, 'rollup values win, item sums fill the gaps')
  assert.equal(d.sugar, 12, 'live rollup omits SUGAR; summed from items')
  assert.equal(d.sodium, 0.125)
})

test('DATA_TYPES derives the filter member from the record kind', () => {
  const { DATA_TYPES } = svc
  assert.equal(Object.keys(DATA_TYPES).length, 42, 'every member of the DataPoint union')
  const filter = (t) => svc.__test.dataFilter(t, DATA_TYPES[t].filterMember || DATA_TYPES[t].kind, '2026-09-01', '2026-09-02')
  assert.equal(filter('heart-rate'), 'heart_rate.sample_time.civil_time >= "2026-09-01" AND heart_rate.sample_time.civil_time < "2026-09-02"')
  assert.equal(filter('active-zone-minutes'), 'active_zone_minutes.interval.civil_start_time >= "2026-09-01" AND active_zone_minutes.interval.civil_start_time < "2026-09-02"')
  assert.equal(filter('nutrition-log'), 'nutrition_log.interval.civil_start_time >= "2026-09-01" AND nutrition_log.interval.civil_start_time < "2026-09-02"')
  assert.equal(filter('daily-heart-rate-zones'), 'daily_heart_rate_zones.date >= "2026-09-01" AND daily_heart_rate_zones.date < "2026-09-02"')
  assert.equal(filter('sleep'), 'sleep.interval.civil_end_time >= "2026-09-01" AND sleep.interval.civil_end_time < "2026-09-02"', 'sleep rejects civil_start_time')
  assert.equal(filter('electrocardiogram'), 'electrocardiogram.interval.start_time >= "2026-09-01T00:00:00Z"')
  assert.equal(DATA_TYPES.electrocardiogram.op, 'list')
  assert.equal(DATA_TYPES.food.kind, 'catalog')
  for (const t of ['symptoms', 'moods', 'menstrual-period', 'ovulation-test']) assert.equal(DATA_TYPES[t].writeOnly, true, t)
  assert.equal(Object.values(DATA_TYPES).filter((m) => m.writeOnly).length, 4)
})

test('queryDataPoints: catalog ignores dates, sessions page by 25, truncated flags an unfinished walk', async () => {
  await withFetch((url) => url.includes('/food/') ? { dataPoints: [{ name: 'f1', food: {} }] } : { dataPoints: [WORKOUT], nextPageToken: 'more' }, async (urls) => {
    const food = await svc.queryDataPoints('tok', 'food', '2026-09-01', '2026-09-02')
    assert.equal(new URL(urls[0]).pathname, '/v4/users/me/dataTypes/food/dataPoints', 'catalog → plain list')
    assert.equal(new URL(urls[0]).searchParams.get('filter'), null)
    assert.deepEqual({ ...food, data_points: undefined }, { data_type: 'food', kind: 'catalog', count: 1, truncated: false, data_points: undefined })

    const ex = await svc.queryDataPoints('tok', 'exercise', '2026-09-01', '2026-09-02', { maxPages: 2 })
    assert.equal(urls.length, 3, 'stopped at maxPages')
    assert.equal(new URL(urls[1]).searchParams.get('pageSize'), '25')
    assert.equal(new URL(urls[2]).searchParams.get('pageToken'), 'more')
    assert.equal(ex.count, 2)
    assert.equal(ex.truncated, true)
    assert.equal(ex.kind, 'session')
  })
})

test('queryDataPoints trims electrocardiogram to `to` client-side (the API filter has no upper bound) and defaults sample/interval pages to 2', async () => {
  const ecgPoints = [
    { name: 'e1', electrocardiogram: { interval: { startTime: '2026-06-03T00:00:00Z' } } }, // inside [from,to)
    { name: 'e2', electrocardiogram: { interval: { startTime: '2026-08-30T00:00:00Z' } } }, // outside — server-side filter can't exclude it
  ]
  await withFetch(() => ({ dataPoints: ecgPoints }), async () => {
    const ecg = await svc.queryDataPoints('tok', 'electrocardiogram', '2026-06-01', '2026-06-08')
    assert.deepEqual(ecg.data_points.map((p) => p.name), ['e1'])
    assert.equal(ecg.count, 1)
  })
  await withFetch(() => ({ dataPoints: [{ name: 'h1' }], nextPageToken: 'more' }), async (urls) => {
    const hr = await svc.queryDataPoints('tok', 'heart-rate', '2026-06-01', '2026-06-08') // no maxPages passed
    assert.equal(urls.length, 2, 'sample kind defaults to 2 pages, not 20')
    assert.equal(hr.truncated, true)
  })
})

test('queryDataPoints rejects write-only and unknown types before touching the network', async () => {
  await withFetch(() => { throw new Error('must not fetch') }, async () => {
    await assert.rejects(() => svc.queryDataPoints('tok', 'symptoms', '2026-09-01', '2026-09-02'),
      { message: 'symptoms is write-only in Google Health (create/update/batchDelete only); it cannot be read.' })
    await assert.rejects(() => svc.queryDataPoints('tok', 'nope', '2026-09-01', '2026-09-02'), /Unknown Google Health data type "nope"\. Valid: .*heart-rate.*/)
  })
})

test('sync translation adds heartRateZones and breathingSleep without touching other endpoints', () => {
  const ep = svc.__test.translateGoogleHealth({ heartRateZonesRaw: { dataPoints: [HRZ] }, breathingSleepRaw: { dataPoints: [RRSS] } }, '2026-09-02')
  assert.deepEqual(ep.heartRateZones, { values: [{ date: '2026-09-02', zones: [
    { type: 'LIGHT', min: 30, max: 112 }, { type: 'MODERATE', min: 113, max: 139 }, { type: 'VIGOROUS', min: 140, max: 173 }, { type: 'PEAK', min: 174, max: 220 },
  ] }] })
  assert.deepEqual(ep.breathingSleep, { values: [{ date: '2026-09-01', time: '03:10',
    deep: { bpm: 18.4, sd: 1, snr: 9.4 }, light: { bpm: 17.6, sd: 1.2, snr: 8.3 }, rem: { bpm: 18, sd: 2.2, snr: 3.6 }, full: { bpm: 18.4, sd: 1, snr: 9.4 } }] })
  assert.deepEqual(ep.activities, { activities: [] }, 'existing shapes intact')
  assert.equal(ep.heartTrend['activities-heart'].length, 0)
})

test('googlehealth.cjs wrappers pass a valid token through and re-export DATA_TYPES', async () => {
  const { gh } = ghFixture()
  const calls = []
  gh.__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    fetchExerciseSessions: async (...a) => { calls.push(['sessions', ...a]); return { sessions: [] } },
    fetchExerciseSession: async (...a) => { calls.push(['session', ...a]); return {} },
    exportExerciseTcx: async (...a) => { calls.push(['tcx', ...a]); return '<xml/>' },
    queryDataPoints: async (...a) => { calls.push(['query', ...a]); return { count: 0 } },
  })
  await gh.fetchExerciseSessions('2026-09-01', '2026-09-03')
  await gh.fetchExerciseSession('users/me/dataTypes/exercise/dataPoints/1')
  await gh.exportExerciseTcx('users/me/dataTypes/exercise/dataPoints/1')
  await gh.queryDataPoints('steps', '2026-09-01', '2026-09-02', { maxPages: 3 })
  assert.deepEqual(calls, [
    ['sessions', 'a', '2026-09-01', '2026-09-03'],
    ['session', 'a', 'users/me/dataTypes/exercise/dataPoints/1'],
    ['tcx', 'a', 'users/me/dataTypes/exercise/dataPoints/1'],
    ['query', 'a', 'steps', '2026-09-01', '2026-09-02', { maxPages: 3 }],
  ])
  assert.equal(gh.DATA_TYPES.exercise.kind, 'session')
})

// ===== write path: createNutritionLog / createHydrationLog / createWeight / deleteDataPoint =====

// Operation-wrapper shape proven live (fact 2): the created name is at body.response.name.
function operationOf(dataPoint) { return { done: true, response: dataPoint } }

test('createNutritionLog unwraps the Operation, synthesizes a 60s interval from a single startTime, and converts mg nutrients to grams', async () => {
  await withFetch((url, init) => {
    assert.equal(new URL(url).pathname, '/v4/users/me/dataTypes/nutrition-log/dataPoints')
    assert.equal(init.method, 'POST')
    const body = JSON.parse(init.body)
    assert.equal(body.interval, undefined, 'fields must nest under nutritionLog, never sit at the body root')
    const nl = body.nutritionLog
    assert.equal(nl.interval.startTime, '2026-09-01T12:00:00.000Z')
    assert.equal(nl.interval.endTime, '2026-09-01T12:01:00.000Z')
    // without these Google files the entry at UTC wall-clock time (a 12:55 CDT log shows as 17:55)
    assert.match(nl.interval.startUtcOffset, /^-?\d+s$/)
    assert.match(nl.interval.endUtcOffset, /^-?\d+s$/)
    assert.equal(nl.foodDisplayName, 'Banana')
    assert.equal(nl.mealType, 'SNACK')
    assert.equal(nl.serving.amount, 1)
    assert.equal(nl.energy.kcal, 105)
    assert.equal(nl.totalCarbohydrate.grams, 27)
    assert.equal(nl.totalFat.grams, 0.4)
    assert.equal(body.dataSource, undefined, 'never send dataSource — let Google default to UNKNOWN')
    const bySodium = nl.nutrients.find((n) => n.nutrient === 'SODIUM')
    assert.equal(bySodium.quantity.grams, 0.001, '1mg sodium -> 0.001g')
    assert.equal(nl.nutrients.find((n) => n.nutrient === 'PROTEIN').quantity.grams, 1.3)
    assert.equal(nl.nutrients.find((n) => n.nutrient === 'DIETARY_FIBER'), undefined, 'omitted params produce no nutrient entry')
    return operationOf({ name: 'users/me/dataTypes/nutrition-log/dataPoints/123', nutritionLog: { foodDisplayName: 'Banana' } })
  }, async () => {
    const out = await svc.createNutritionLog('tok', {
      startTime: '2026-09-01T12:00:00Z', foodDisplayName: 'Banana', mealType: 'SNACK',
      servingAmount: 1, calories: 105, carbsG: 27, fatG: 0.4, proteinG: 1.3, sodiumMg: 1,
    })
    assert.equal(out.name, 'users/me/dataTypes/nutrition-log/dataPoints/123')
    assert.equal(out.raw.nutritionLog.foodDisplayName, 'Banana')
  })
})

test('createNutritionLog writes serving_unit to the writable foodMeasurementUnit field, not the readOnly display-name field', async () => {
  await withFetch((url, init) => {
    const body = JSON.parse(init.body).nutritionLog
    assert.equal(body.serving.foodMeasurementUnit, 'cup')
    assert.equal(body.serving.foodMeasurementUnitDisplayName, undefined, 'that field is readOnly/Output-only on write — never send it')
    return operationOf({ name: 'users/me/dataTypes/nutrition-log/dataPoints/999', nutritionLog: {} })
  }, async () => {
    await svc.createNutritionLog('tok', {
      startTime: '2026-09-01T12:00:00Z', foodDisplayName: 'Oats', mealType: 'BREAKFAST',
      servingAmount: 1, servingUnit: 'cup', calories: 1, carbsG: 1, fatG: 1,
    })
  })
})

test('createNutritionLog rejects an explicit endTime <= startTime instead of sending a zero-width interval', async () => {
  await withFetch(() => { throw new Error('must not fetch') }, async () => {
    await assert.rejects(() => svc.createNutritionLog('tok', {
      startTime: '2026-09-01T12:00:00Z', endTime: '2026-09-01T12:00:00Z',
      foodDisplayName: 'X', mealType: 'SNACK', servingAmount: 1, calories: 1, carbsG: 1, fatG: 1,
    }), /endTime must be after startTime/)
  })
})

test('createHydrationLog posts amountConsumed.milliliters with a synthesized interval', async () => {
  await withFetch((url, init) => {
    assert.equal(new URL(url).pathname, '/v4/users/me/dataTypes/hydration-log/dataPoints')
    const raw = JSON.parse(init.body)
    assert.equal(raw.interval, undefined, 'fields must nest under hydrationLog, never sit at the body root')
    const body = raw.hydrationLog
    assert.equal(body.interval.startTime, '2026-09-01T09:00:00.000Z')
    assert.equal(body.interval.endTime, '2026-09-01T09:01:00.000Z')
    assert.match(body.interval.startUtcOffset, /^-?\d+s$/)
    assert.match(body.interval.endUtcOffset, /^-?\d+s$/)
    assert.equal(body.amountConsumed.milliliters, 250)
    return operationOf({ name: 'users/me/dataTypes/hydration-log/dataPoints/456', hydrationLog: {} })
  }, async () => {
    const out = await svc.createHydrationLog('tok', { startTime: '2026-09-01T09:00:00Z', milliliters: 250 })
    assert.equal(out.name, 'users/me/dataTypes/hydration-log/dataPoints/456')
  })
})

test('createWeight uses a point sampleTime (no interval) and passes weightGrams through', async () => {
  await withFetch((url, init) => {
    assert.equal(new URL(url).pathname, '/v4/users/me/dataTypes/weight/dataPoints')
    const raw = JSON.parse(init.body)
    assert.equal(raw.sampleTime, undefined, 'fields must nest under weight, never sit at the body root')
    const body = raw.weight
    assert.equal(body.sampleTime.physicalTime, '2026-09-01T09:00:00.000Z')
    assert.match(body.sampleTime.utcOffset, /^-?\d+s$/, 'weight needs the offset too or it lands at UTC wall-clock time')
    assert.equal(body.weightGrams, 72_500)
    assert.equal(body.notes, 'morning')
    assert.equal(body.interval, undefined)
    return operationOf({ name: 'users/me/dataTypes/weight/dataPoints/789', weight: { weightGrams: 72_500 } })
  }, async () => {
    const out = await svc.createWeight('tok', { physicalTime: '2026-09-01T09:00:00Z', weightGrams: 72_500, notes: 'morning' })
    assert.equal(out.name, 'users/me/dataTypes/weight/dataPoints/789')
  })
})

test('deleteDataPoint derives the type segment from three different name shapes and batchDeletes', async () => {
  const cases = [
    ['users/6576655628228310145/dataTypes/hydration-log/dataPoints/1', 'hydration-log'],
    ['users/me/dataTypes/nutrition-log/dataPoints/2', 'nutrition-log'],
    ['users/6576655628228310145/dataTypes/weight/dataPoints/3', 'weight'],
  ]
  for (const [name, type] of cases) {
    await withFetch((url, init) => {
      assert.equal(new URL(url).pathname, `/v4/users/me/dataTypes/${type}/dataPoints:batchDelete`)
      assert.deepEqual(JSON.parse(init.body), { names: [name] })
      return operationOf({ dataPoints: [{ name }] })
    }, async () => {
      const out = await svc.deleteDataPoint('tok', name)
      assert.deepEqual(out, { deleted: true, name })
    })
  }
})

test('deleteDataPoint rejects a name it cannot parse a data type out of', async () => {
  await withFetch(() => { throw new Error('must not fetch') }, async () => {
    await assert.rejects(() => svc.deleteDataPoint('tok', 'not-a-real-name'), /Cannot parse a Google Health data type/)
  })
})

test('deleteDataPoint refuses a data type outside the three this write surface creates (e.g. a name copied from a read tool)', async () => {
  await withFetch(() => { throw new Error('must not fetch') }, async () => {
    await assert.rejects(
      () => svc.deleteDataPoint('tok', 'users/me/dataTypes/heart-rate/dataPoints/998877'),
      /Refusing to delete data type "heart-rate"/,
    )
  })
})

test('googlehealth.cjs write wrappers forward params to the service layer with a valid token', async () => {
  const { gh } = ghFixture()
  const calls = []
  gh.__setGoogleHealthForTest({
    refreshAccessToken: async () => ({ access_token: 'a', expiresAt: Date.now() + 3_600_000 }),
    createNutritionLog: async (...a) => { calls.push(['meal', ...a]); return { name: 'n1' } },
    createHydrationLog: async (...a) => { calls.push(['water', ...a]); return { name: 'n2' } },
    createWeight: async (...a) => { calls.push(['weight', ...a]); return { name: 'n3' } },
    deleteDataPoint: async (...a) => { calls.push(['delete', ...a]); return { deleted: true, name: a[1] } },
  })
  const mealParams = { startTime: '2026-09-01T12:00:00Z', foodDisplayName: 'Banana', mealType: 'SNACK', servingAmount: 1, calories: 105, carbsG: 27, fatG: 0.4 }
  await gh.writeMeal(mealParams)
  await gh.writeHydration({ startTime: '2026-09-01T09:00:00Z', milliliters: 250 })
  await gh.writeWeight({ physicalTime: '2026-09-01T09:00:00Z', weightGrams: 72_500 })
  await gh.deleteGoogleHealthEntry('users/me/dataTypes/weight/dataPoints/789')
  assert.deepEqual(calls, [
    ['meal', 'a', mealParams],
    ['water', 'a', { startTime: '2026-09-01T09:00:00Z', milliliters: 250 }],
    ['weight', 'a', { physicalTime: '2026-09-01T09:00:00Z', weightGrams: 72_500 }],
    ['delete', 'a', 'users/me/dataTypes/weight/dataPoints/789'],
  ])
})
