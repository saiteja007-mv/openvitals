'use strict'

const crypto = require('node:crypto')

const API_BASE = 'https://health.googleapis.com/v4'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const SCOPES = [
  'openid',
  'profile',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.ecg.readonly',
  'https://www.googleapis.com/auth/googlehealth.irn.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
  'https://www.googleapis.com/auth/googlehealth.settings.readonly',
  // Write scopes (2026-09-02): the v4 API supports dataPoints.create/patch/batchDelete. nutrition.writeonly
  // covers nutrition-log AND hydration-log; health_metrics_and_measurements.writeonly covers weight.
  // Any scope change needs a fresh consent: node server/login-gh.cjs
  'https://www.googleapis.com/auth/googlehealth.nutrition.writeonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly',
  // exercise sessions (2026-09-03). NOTE: v4 Exercise has no sets/reps/weight fields at all —
  // 'repetition' appears zero times in the discovery doc — so set detail can only ride in the
  // session's free-text `notes`. Structured sets stay in the local workouts table.
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly',
]

let nextApiRequestAt = 0

function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

function base64Url(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(48))
  return {
    verifier,
    challenge: base64Url(crypto.createHash('sha256').update(verifier).digest()),
  }
}

function createAuthorizationUrl(config, state, pkce) {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

async function tokenRequest(parameters) {
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Google OAuth ha risposto ${response.status}.`)
  }
  return {
    ...payload,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  }
}

function exchangeAuthorizationCode(config, code, verifier) {
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  })
}

async function refreshAccessToken(config, token) {
  if (!token.refresh_token) throw new Error('The Google refresh token is unavailable: reconnect the account.')
  const refreshed = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  })
  return { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token }
}

async function revokeToken(token) {
  const value = token?.refresh_token || token?.access_token
  if (!value) return
  const response = await fetchWithTimeout(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: value }),
  })
  if (!response.ok) throw new Error(`Google did not confirm token revocation (${response.status}).`)
}

async function waitForApiSlot() {
  const now = Date.now()
  const slot = Math.max(now, nextApiRequestAt)
  nextApiRequestAt = slot + 225
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now))
}

// raw: return the body as text (TCX export is XML, not JSON).
async function request(path, accessToken, { method = 'GET', body, raw = false, retryCount = 0 } = {}) {
  await waitForApiSlot()
  const response = await fetchWithTimeout(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: raw ? '*/*' : 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 429 && retryCount < 2) {
    const retryAfter = Number(response.headers.get('retry-after'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(30_000, retryAfter * 1000)
      : Math.min(30_000, 1_100 * (2 ** retryCount))
    await new Promise((resolve) => setTimeout(resolve, delay))
    return request(path, accessToken, { method, body, raw, retryCount: retryCount + 1 })
  }
  const payload = raw && response.ok ? await response.text() : await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Google Health ha risposto ${response.status}.`)
    error.status = response.status
    throw error
  }
  return payload
}

function shiftIso(value, days) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return date.toISOString().slice(0, 10)
}

function civilDateTime(value, endOfDay = false) {
  const [year, month, day] = value.split('-').map(Number)
  // Match the REST example exactly. Although the schema describes a
  // closed-open interval, the current v4 endpoint expects the final civil day
  // at 23:59:59 instead of the following day at midnight.
  return {
    date: { year, month, day },
    time: endOfDay
      ? { hours: 23, minutes: 59, seconds: 59, nanos: 0 }
      : { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
  }
}

function dateFromCivil(value) {
  const date = value?.date || value
  if (!date?.year || !date?.month || !date?.day) return null
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function timeFromCivil(value) {
  const time = value?.time || value
  if (typeof time?.hours !== 'number') return null
  return `${String(time.hours).padStart(2, '0')}:${String(time.minutes || 0).padStart(2, '0')}`
}

function durationSeconds(value) {
  if (typeof value !== 'string') return 0
  const parsed = Number(value.replace(/s$/, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

// Every readable data type in the v4 DataPoint union (42 in today's discovery doc).
// kind decides the filter member + page size; writeOnly types 400 on list/reconcile
// ("create, update, batchDelete" only). filterMember overrides the kind default —
// sleep rejects civil_start_time, ecg only accepts a physical start_time lower bound.
const kinds = (kind, op, names, extra = {}) => Object.fromEntries(names.map((n) => [n, { kind, op, writeOnly: false, ...extra }]))
const DATA_TYPES = {
  ...kinds('sample', 'reconcile', ['heart-rate', 'heart-rate-variability', 'oxygen-saturation', 'weight', 'body-fat', 'height', 'blood-glucose', 'core-body-temperature', 'vo2-max', 'run-vo2-max', 'respiratory-rate-sleep-summary']),
  ...kinds('sample', 'reconcile', ['symptoms', 'moods', 'ovulation-test'], { writeOnly: true }),
  ...kinds('interval', 'reconcile', ['steps', 'distance', 'floors', 'altitude', 'active-minutes', 'active-zone-minutes', 'active-energy-burned', 'basal-energy-burned', 'sedentary-period', 'time-in-heart-rate-zone', 'activity-level', 'swim-lengths-data']),
  ...kinds('interval', 'reconcile', ['menstrual-period'], { writeOnly: true }),
  ...kinds('session', 'reconcile', ['exercise', 'nutrition-log', 'hydration-log']),
  sleep: { kind: 'session', op: 'reconcile', writeOnly: false, filterMember: 'interval.civil_end_time' },
  electrocardiogram: { kind: 'session', op: 'list', writeOnly: false, filterMember: 'interval.start_time' },
  'irregular-rhythm-notification': { kind: 'session', op: 'list', writeOnly: false },
  ...kinds('daily', 'reconcile', ['daily-resting-heart-rate', 'daily-heart-rate-variability', 'daily-oxygen-saturation', 'daily-respiratory-rate', 'daily-sleep-temperature-derivations', 'daily-vo2-max', 'daily-heart-rate-zones']),
  ...kinds('catalog', 'list', ['food', 'food-measurement-unit']),
}

// recordType is a kind (or the legacy 'sleep'/'ecg' aliases) or an explicit member path.
const FILTER_MEMBER = { sample: 'sample_time.civil_time', interval: 'interval.civil_start_time', session: 'interval.civil_start_time', daily: 'date', sleep: 'interval.civil_end_time', ecg: 'interval.start_time' }
function dataFilter(type, recordType, start, end) {
  const member = `${type.replaceAll('-', '_')}.${FILTER_MEMBER[recordType] || recordType}`
  // physical (non-civil) start_time: the endpoint only takes the lower bound; callers trim the upper bound client-side
  if (member.endsWith('.start_time')) return `${member} >= "${start}T00:00:00Z"`
  return `${member} >= "${start}" AND ${member} < "${end}"`
}

// Follow nextPageToken up to maxPages; truncated=true means there was more.
async function pageThrough(accessToken, type, baseParams, operation, maxPages) {
  const endpoint = operation === 'list' ? 'dataPoints' : 'dataPoints:reconcile'
  const dataPoints = []
  let pageToken = ''
  let pageCount = 0
  do {
    const params = new URLSearchParams(baseParams)
    if (pageToken) params.set('pageToken', pageToken)
    const page = await request(`/users/me/dataTypes/${type}/${endpoint}?${params}`, accessToken)
    if (Array.isArray(page.dataPoints)) dataPoints.push(...page.dataPoints)
    pageToken = page.nextPageToken || ''
    pageCount += 1
  } while (pageToken && pageCount < maxPages)
  return { dataPoints, truncated: Boolean(pageToken) }
}

async function listData(accessToken, type, recordType, start, end, dataSourceFamily = 'all-sources', operation = 'reconcile') {
  const baseParams = {
    filter: dataFilter(type, recordType, start, end),
    pageSize: type === 'sleep' || type === 'exercise' ? '25' : '10000',
  }
  if (operation === 'reconcile') baseParams.dataSourceFamily = `users/me/dataSourceFamilies/${dataSourceFamily}`
  const { dataPoints, truncated } = await pageThrough(accessToken, type, baseParams, operation, 100)
  if (truncated) throw new Error(`Google Health ha restituito troppe pagine per ${type}.`)
  return { dataPoints } // shape is stored verbatim in some endpoints (irn alerts, glucose) — keep it
}

// Generic escape hatch over every readable type. Raw dataPoints, no translation.
async function queryDataPoints(accessToken, dataType, from, to, { maxPages } = {}) {
  const meta = DATA_TYPES[dataType]
  if (!meta) throw new Error(`Unknown Google Health data type "${dataType}". Valid: ${Object.keys(DATA_TYPES).join(', ')}`)
  if (meta.writeOnly) throw new Error(`${dataType} is write-only in Google Health (create/update/batchDelete only); it cannot be read.`)
  // Only exercise and sleep actually cap at 25 server-side (mirrors listData); the other session
  // kinds (nutrition-log, hydration-log, electrocardiogram, irregular-rhythm-notification) take
  // 1000 and paginating them at 25 was 40x more calls than needed (LOW: runtime-R6).
  const params = { pageSize: dataType === 'exercise' || dataType === 'sleep' ? '25' : '1000' }
  if (meta.kind !== 'catalog') params.filter = dataFilter(dataType, meta.filterMember || meta.kind, from, to)
  if (meta.op === 'reconcile') params.dataSourceFamily = 'users/me/dataSourceFamilies/all-sources'
  // sample/interval defaults were unbounded (pageSize 1000 x 20 pages = up to 20k points, multi-MB
  // once pretty-printed) — cap the default; an explicit max_pages (the tool caps it at 100) overrides.
  const pages = maxPages ?? (meta.kind === 'sample' || meta.kind === 'interval' ? 2 : 20)
  let { dataPoints, truncated } = await pageThrough(accessToken, dataType, params, meta.op, pages)
  // electrocardiogram's filter has no upper bound (physical start_time >= from only, see dataFilter) —
  // trim to `to` here so this generic reader honors the range like every other kind does.
  if (meta.filterMember === 'interval.start_time') {
    const upper = `${to}T00:00:00Z`
    dataPoints = dataPoints.filter((p) => { const t = p[dataType]?.interval?.startTime; return !t || t < upper })
  }
  return { data_type: dataType, kind: meta.kind, count: dataPoints.length, truncated, data_points: dataPoints }
}

function dailyRollup(accessToken, type, start, end) {
  return request(`/users/me/dataTypes/${type}/dataPoints:dailyRollUp`, accessToken, {
    method: 'POST',
    body: {
      range: {
        start: civilDateTime(start),
        end: civilDateTime(shiftIso(end, -1), true),
      },
      windowSizeDays: 1,
    },
  })
}

async function syncGoogleHealthData(accessToken, selectedDate, onProgress = () => {}) {
  const trendStart = shiftIso(selectedDate, -13)
  const dayAfter = shiftIso(selectedDate, 1)
  const ecgStart = shiftIso(selectedDate, -90)
  const jobs = [
    ['identity', () => request('/users/me/identity', accessToken)],
    ['profileRaw', () => request('/users/me/profile', accessToken)],
    ['settingsRaw', () => request('/users/me/settings', accessToken)],
    ['devicesRaw', () => request('/users/me/pairedDevices?pageSize=100', accessToken)],
    ['userInfo', () => request('https://www.googleapis.com/oauth2/v3/userinfo', accessToken)],
    ['stepsDaily', () => dailyRollup(accessToken, 'steps', trendStart, dayAfter)],
    ['caloriesDaily', () => dailyRollup(accessToken, 'total-calories', trendStart, dayAfter)],
    ['distanceDaily', () => dailyRollup(accessToken, 'distance', trendStart, dayAfter)],
    ['floorsDaily', () => dailyRollup(accessToken, 'floors', trendStart, dayAfter)],
    ['activeMinutesDaily', () => dailyRollup(accessToken, 'active-minutes', trendStart, dayAfter)],
    ['zoneMinutesDaily', () => dailyRollup(accessToken, 'active-zone-minutes', trendStart, dayAfter)],
    ['sedentaryDaily', () => dailyRollup(accessToken, 'sedentary-period', trendStart, dayAfter)],
    ['weightDaily', () => dailyRollup(accessToken, 'weight', trendStart, dayAfter)],
    ['fatDaily', () => dailyRollup(accessToken, 'body-fat', trendStart, dayAfter)],
    ['waterDaily', () => dailyRollup(accessToken, 'hydration-log', trendStart, dayAfter)],
    ['nutritionDaily', () => dailyRollup(accessToken, 'nutrition-log', trendStart, dayAfter)],
    ['coreTemperatureDaily', () => dailyRollup(accessToken, 'core-body-temperature', trendStart, dayAfter)],
    ['stepsIntradayRaw', () => listData(accessToken, 'steps', 'interval', selectedDate, dayAfter, 'google-wearables')],
    ['heartIntradayRaw', () => listData(accessToken, 'heart-rate', 'sample', selectedDate, dayAfter, 'google-wearables')],
    ['restingHeartRaw', () => listData(accessToken, 'daily-resting-heart-rate', 'daily', trendStart, dayAfter)],
    ['hrvRaw', () => listData(accessToken, 'daily-heart-rate-variability', 'daily', trendStart, dayAfter)],
    ['spo2Raw', () => listData(accessToken, 'daily-oxygen-saturation', 'daily', trendStart, dayAfter)],
    ['breathingRaw', () => listData(accessToken, 'daily-respiratory-rate', 'daily', trendStart, dayAfter)],
    ['skinTemperatureRaw', () => listData(accessToken, 'daily-sleep-temperature-derivations', 'daily', trendStart, dayAfter)],
    ['cardioRaw', () => listData(accessToken, 'daily-vo2-max', 'daily', trendStart, dayAfter)],
    ['sleepRaw', () => listData(accessToken, 'sleep', 'sleep', trendStart, dayAfter, 'google-wearables')],
    ['activitiesRaw', () => listData(accessToken, 'exercise', 'session', trendStart, dayAfter)],
    ['ecgRaw', () => listData(accessToken, 'electrocardiogram', 'ecg', ecgStart, dayAfter, 'all-sources', 'list')],
    ['irnProfileRaw', () => request('/users/me/irnProfile', accessToken)],
    ['irnAlertsRaw', () => listData(accessToken, 'irregular-rhythm-notification', 'session', trendStart, dayAfter, 'all-sources', 'list')],
    ['glucoseRaw', () => listData(accessToken, 'blood-glucose', 'sample', trendStart, dayAfter)],
    ['heartRateZonesRaw', () => listData(accessToken, 'daily-heart-rate-zones', 'daily', trendStart, dayAfter)],
    ['breathingSleepRaw', () => listData(accessToken, 'respiratory-rate-sleep-summary', 'sample', trendStart, dayAfter)],
  ]
  const endpoints = {}
  const errors = []
  let completed = 0

  await Promise.all(jobs.map(async ([key, run]) => {
    try {
      endpoints[key] = await run()
    } catch (error) {
      errors.push({ key, message: error.message || 'Source unavailable', status: error.status })
    } finally {
      completed += 1
      onProgress({ completed, total: jobs.length, key })
    }
  }))

  if (errors.some((error) => error.status === 401)) {
    throw new Error('The Google Health authorization is no longer valid. Reconnect the account.')
  }

  return {
    source: 'google-health',
    date: selectedDate,
    generatedAt: new Date().toISOString(),
    endpoints: translateGoogleHealth(endpoints, selectedDate),
    errors,
    rateLimit: { limit: 300, remaining: null, resetSeconds: 60 },
    requestStats: { total: jobs.length, succeeded: Object.keys(endpoints).length, successfulKeys: Object.keys(endpoints) },
  }
}

function rollupPoints(payload) {
  return Array.isArray(payload?.rollupDataPoints) ? payload.rollupDataPoints : []
}

function dataPoints(payload) {
  return Array.isArray(payload?.dataPoints) ? payload.dataPoints : []
}

function dailyMap(payload, extractor) {
  return new Map(rollupPoints(payload).map((point) => [dateFromCivil(point.civilStartTime), extractor(point)]).filter(([date]) => date))
}

function dailyRecordMap(payload, key, extractor) {
  return new Map(dataPoints(payload).map((point) => {
    const record = point[key]
    return [dateFromCivil(record?.date), extractor(record)]
  }).filter(([date]) => date))
}

function selected(map, date) {
  return map.get(date) ?? null
}

function numeric(value, transform = (number) => number) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? transform(parsed) : null
}

function sleepStageKey(value) {
  const type = String(value || '').toLowerCase()
  if (type === 'awake' || type === 'restless') return 'wake'
  if (type === 'asleep') return 'light'
  return ['deep', 'light', 'rem', 'wake'].includes(type) ? type : null
}

function toLegacySleep(point) {
  const sleep = point.sleep || {}
  const summary = sleep.summary || {}
  const stageSummaries = summary.stagesSummary || []
  const hasDetailedStages = stageSummaries.some((stage) => ['LIGHT', 'DEEP', 'REM'].includes(String(stage.type || '').toUpperCase()))
  const uniqueStageSummaries = stageSummaries.reduce((result, stage) => {
    const rawType = String(stage.type || '').toLowerCase()
    if (!rawType) return result
    const previous = result[rawType] || { minutes: 0, count: null }
    const count = numeric(stage.count)
    result[rawType] = {
      // Reconciled responses can repeat the same aggregate. Keep the largest
      // value per raw type before merging compatible classic-sleep buckets.
      minutes: Math.max(previous.minutes, numeric(stage.minutes) ?? 0),
      count: count === null ? previous.count : Math.max(previous.count ?? 0, count),
    }
    return result
  }, {})
  const stageMap = Object.entries(uniqueStageSummaries).reduce((result, [rawType, values]) => {
    // ASLEEP is the aggregate of LIGHT/DEEP/REM when detailed stages exist.
    if (rawType === 'asleep' && hasDetailedStages) return result
    const key = sleepStageKey(rawType)
    if (!key) return result
    const previous = result[key] || { minutes: 0, count: null }
    result[key] = {
      minutes: previous.minutes + values.minutes,
      count: values.count === null ? previous.count : (previous.count ?? 0) + values.count,
    }
    return result
  }, {})
  const stageTimeline = (Array.isArray(sleep.stages) ? sleep.stages : []).map((stage) => {
    const level = sleepStageKey(stage.type)
    if (!level || !stage.startTime || !stage.endTime) return null
    const seconds = (new Date(stage.endTime) - new Date(stage.startTime)) / 1000
    return {
      dateTime: stage.startTime,
      endTime: stage.endTime,
      level,
      seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : null,
    }
  }).filter(Boolean)
  const asleep = numeric(summary.minutesAsleep) ?? 0
  const period = numeric(summary.minutesInSleepPeriod)
  const endCivil = sleep.interval?.civilEndTime
  const dateOfSleep = dateFromCivil(endCivil) || sleep.interval?.endTime?.slice(0, 10)
  return {
    logId: point.dataPointName ?? point.name,
    dateOfSleep,
    isMainSleep: sleep.metadata?.nap !== true,
    minutesAsleep: asleep,
    minutesAwake: numeric(summary.minutesAwake),
    minutesToFallAsleep: numeric(summary.minutesToFallAsleep),
    minutesAfterWakeUp: numeric(summary.minutesAfterWakeUp),
    timeInBed: period,
    efficiency: period && period > 0 ? Math.round(asleep / period * 100) : null,
    startTime: sleep.interval?.startTime || null,
    endTime: sleep.interval?.endTime || null,
    levels: { summary: stageMap, data: stageTimeline },
  }
}

function translateGoogleHealth(raw, selectedDate) {
  const steps = dailyMap(raw.stepsDaily, (point) => numeric(point.steps?.countSum))
  const calories = dailyMap(raw.caloriesDaily, (point) => numeric(point.totalCalories?.kcalSum))
  const distance = dailyMap(raw.distanceDaily, (point) => numeric(point.distance?.millimetersSum, (value) => value / 1_000_000))
  const floors = dailyMap(raw.floorsDaily, (point) => numeric(point.floors?.countSum))
  const activeMinutes = dailyMap(raw.activeMinutesDaily, (point) => {
    if (!point.activeMinutes) return null
    const levels = point.activeMinutes?.activeMinutesRollupByActivityLevel || []
    return Object.fromEntries(levels.map((level) => [level.activityLevel, Number(level.activeMinutesSum || 0)]))
  })
  const zoneMinutes = dailyMap(raw.zoneMinutesDaily, (point) => point.activeZoneMinutes ? Object.values(point.activeZoneMinutes).reduce((sum, value) => sum + Number(value || 0), 0) : null)
  const sedentary = dailyMap(raw.sedentaryDaily, (point) => point.sedentaryPeriod?.durationSum === undefined ? null : durationSeconds(point.sedentaryPeriod.durationSum) / 60)
  const weights = dailyMap(raw.weightDaily, (point) => numeric(point.weight?.weightGramsAvg, (value) => value / 1000))
  const bodyFat = dailyMap(raw.fatDaily, (point) => numeric(point.bodyFat?.bodyFatPercentageAvg))
  const water = dailyMap(raw.waterDaily, (point) => numeric(point.hydrationLog?.amountConsumed?.millilitersSum))
  const nutrition = dailyMap(raw.nutritionDaily, (point) => numeric(point.nutritionLog?.energy?.kcalSum))
  const coreTemperature = dailyMap(raw.coreTemperatureDaily, (point) => numeric(point.coreBodyTemperature?.temperatureCelsiusAvg))
  const restingHeart = dailyRecordMap(raw.restingHeartRaw, 'dailyRestingHeartRate', (record) => numeric(record?.beatsPerMinute))
  const hrv = dailyRecordMap(raw.hrvRaw, 'dailyHeartRateVariability', (record) => ({
    averageMs: numeric(record?.averageHeartRateVariabilityMilliseconds ?? record?.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
    deepSleepRmssdMs: numeric(record?.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
    entropy: numeric(record?.entropy),
    nonRemHeartRate: numeric(record?.nonRemHeartRateBeatsPerMinute),
  }))
  const spo2 = dailyRecordMap(raw.spo2Raw, 'dailyOxygenSaturation', (record) => ({
    average: numeric(record?.averagePercentage),
    lowerBound: numeric(record?.lowerBoundPercentage),
    upperBound: numeric(record?.upperBoundPercentage),
  }))
  const breathing = dailyRecordMap(raw.breathingRaw, 'dailyRespiratoryRate', (record) => numeric(record?.breathsPerMinute))
  const skinTemp = dailyRecordMap(raw.skinTemperatureRaw, 'dailySleepTemperatureDerivations', (record) => {
    const nightly = numeric(record?.nightlyTemperatureCelsius)
    const baseline = numeric(record?.baselineTemperatureCelsius)
    return {
      relative: nightly === null || baseline === null ? null : Number((nightly - baseline).toFixed(2)),
      nightly,
      baseline,
      stddev30d: numeric(record?.relativeNightlyStddev30dCelsius),
    }
  })
  const cardio = dailyRecordMap(raw.cardioRaw, 'dailyVo2Max', (record) => numeric(record?.vo2Max))
  const selectedActivityLevels = selected(activeMinutes, selectedDate)
  const todayActivityLevels = selectedActivityLevels || {}
  const sleepRecords = dataPoints(raw.sleepRaw).map(toLegacySleep)
  const selectedSleepRecords = sleepRecords.filter((item) => item.dateOfSleep === selectedDate)
  const selectedSleep = selectedSleepRecords.find((item) => item.isMainSleep)
    || selectedSleepRecords.sort((a, b) => b.minutesAsleep - a.minutesAsleep)[0]
    || null
  const allDates = [...new Set([
    ...steps.keys(),
    ...calories.keys(),
    ...distance.keys(),
    ...floors.keys(),
    ...activeMinutes.keys(),
    ...zoneMinutes.keys(),
    ...sedentary.keys(),
    ...restingHeart.keys(),
    ...hrv.keys(),
    ...spo2.keys(),
    ...breathing.keys(),
    ...skinTemp.keys(),
    ...coreTemperature.keys(),
    ...cardio.keys(),
    ...weights.keys(),
    ...bodyFat.keys(),
    ...water.keys(),
    ...nutrition.keys(),
    ...sleepRecords.map((item) => item.dateOfSleep).filter(Boolean),
  ])].sort()
  const sleepByDate = new Map(sleepRecords
    .filter((item) => item.dateOfSleep && item.isMainSleep !== false)
    .map((item) => [item.dateOfSleep, item]))
  const activeMinutesFor = (date) => {
    const levels = activeMinutes.get(date)
    if (!levels) return null
    const moderate = numeric(levels.MODERATE)
    const vigorous = numeric(levels.VIGOROUS)
    if (moderate === null && vigorous === null) return null
    return (moderate || 0) + (vigorous || 0)
  }
  const stepPoints = dataPoints(raw.stepsIntradayRaw).map((point) => {
    const record = point.steps || {}
    const time = timeFromCivil(record.interval?.civilStartTime) || record.interval?.startTime?.slice(11, 16)
    return { time, value: Number(record.count || 0) }
  }).filter((point) => point.time).sort((a, b) => a.time.localeCompare(b.time))
  const heartPoints = dataPoints(raw.heartIntradayRaw).map((point) => {
    const record = point.heartRate || {}
    const time = timeFromCivil(record.sampleTime?.civilTime) || record.sampleTime?.physicalTime?.slice(11, 16)
    return { time, value: Number(record.beatsPerMinute || 0) }
  }).filter((point) => point.time && point.value).sort((a, b) => a.time.localeCompare(b.time))
  const profile = raw.profileRaw || {}
  const settings = raw.settingsRaw || {}
  const userInfo = raw.userInfo || {}
  const membershipDate = dateFromCivil(profile.membershipStartDate)
  const devices = (raw.devicesRaw?.pairedDevices || []).map((device) => ({
    id: String(device.name || '').split('/').at(-1),
    type: device.deviceType,
    deviceVersion: device.deviceVersion,
    battery: device.batteryStatus,
    batteryLevel: device.batteryLevel,
    lastSyncTime: device.lastSyncTime,
    features: device.features,
  }))
  const todaySteps = selected(steps, selectedDate)
  const todayCalories = selected(calories, selectedDate)
  const todayDistance = selected(distance, selectedDate)
  const todayFloors = selected(floors, selectedDate)
  const todayZone = selected(zoneMinutes, selectedDate)
  const todaySedentary = selected(sedentary, selectedDate)
  const currentWeight = selected(weights, selectedDate) ?? [...weights.values()].filter((value) => value !== null).at(-1) ?? null
  const currentFat = selected(bodyFat, selectedDate) ?? [...bodyFat.values()].filter((value) => value !== null).at(-1) ?? null
  const currentHrv = selected(hrv, selectedDate)
  const currentSpo2 = selected(spo2, selectedDate)
  const currentBreathing = selected(breathing, selectedDate)
  const currentTemp = selected(skinTemp, selectedDate)
  const currentCardio = selected(cardio, selectedDate)
  const currentCoreTemperature = selected(coreTemperature, selectedDate)
  const ecgUpperBound = `${shiftIso(selectedDate, 1)}T00:00:00Z`
  const ecgReadings = dataPoints(raw.ecgRaw)
    .filter((point) => {
      const startTime = point.electrocardiogram?.interval?.startTime
      return !startTime || startTime < ecgUpperBound
    })
    .map((point) => ({
      ...(point.electrocardiogram || {}),
      readingTime: point.electrocardiogram?.interval?.startTime,
    }))
  const activities = dataPoints(raw.activitiesRaw).map((point) => {
    const exercise = point.exercise || {}
    const summary = exercise.metricsSummary || {}
    const start = exercise.interval?.startTime || ''
    const end = exercise.interval?.endTime || ''
    const intervalDuration = (new Date(end) - new Date(start)) / 1000
    const duration = durationSeconds(exercise.activeDuration) || (Number.isFinite(intervalDuration) ? Math.max(0, intervalDuration) : 0)
    return {
      logId: point.dataPointName ?? point.name,
      activityName: exercise.displayName || String(exercise.exerciseType || 'Activity').replaceAll('_', ' '),
      startTime: start,
      duration: duration * 1000,
      calories: summary.caloriesKcal,
      distance: numeric(summary.distanceMillimeters, (value) => value / 1_000_000),
      averageHeartRate: summary.averageHeartRateBeatsPerMinute,
      steps: numeric(summary.steps),
      averagePaceSecondsPerMeter: numeric(summary.averagePaceSecondsPerMeter),
      heartZoneMinutes: heartZoneMinutes(summary),
      activeZoneMinutes: { totalMinutes: summary.activeZoneMinutes },
    }
  })
  const heartRateZones = dataPoints(raw.heartRateZonesRaw).map((point) => {
    const record = point.dailyHeartRateZones || {}
    return {
      date: dateFromCivil(record.date),
      zones: (record.heartRateZones || []).map((zone) => ({ type: zone.heartRateZoneType, min: numeric(zone.minBeatsPerMinute), max: numeric(zone.maxBeatsPerMinute) })),
    }
  }).filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date))
  const breathingSleep = dataPoints(raw.breathingSleepRaw).map((point) => {
    const record = point.respiratoryRateSleepSummary || {}
    const stage = (stats) => stats ? { bpm: numeric(stats.breathsPerMinute), sd: numeric(stats.standardDeviation), snr: numeric(stats.signalToNoise) } : null
    return {
      date: dateFromCivil(record.sampleTime?.civilTime) || record.sampleTime?.physicalTime?.slice(0, 10) || null,
      time: timeFromCivil(record.sampleTime?.civilTime),
      deep: stage(record.deepSleepStats),
      light: stage(record.lightSleepStats),
      rem: stage(record.remSleepStats),
      full: stage(record.fullSleepStats),
    }
  }).filter((item) => item.date).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))

  return {
    profile: { user: { displayName: userInfo.name || 'Atleta', avatar640: userInfo.picture || null, memberSince: membershipDate, timezone: settings.timeZone || null } },
    devices,
    activity: { summary: {
      steps: todaySteps,
      caloriesOut: todayCalories,
      distances: [{ activity: 'total', distance: todayDistance }],
      floors: todayFloors,
      lightlyActiveMinutes: selectedActivityLevels === null ? null : numeric(todayActivityLevels.LIGHT) ?? 0,
      fairlyActiveMinutes: selectedActivityLevels === null ? null : numeric(todayActivityLevels.MODERATE) ?? 0,
      veryActiveMinutes: selectedActivityLevels === null ? null : numeric(todayActivityLevels.VIGOROUS) ?? 0,
      activeZoneMinutes: { totalMinutes: todayZone },
      sedentaryMinutes: todaySedentary,
    } },
    activityGoals: { goals: {} },
    stepsIntraday: { 'activities-steps-intraday': { dataset: stepPoints } },
    caloriesIntraday: { 'activities-calories-intraday': { dataset: [] } },
    heartIntraday: {
      'activities-heart': [{ dateTime: selectedDate, value: { restingHeartRate: selected(restingHeart, selectedDate) } }],
      'activities-heart-intraday': { dataset: heartPoints },
    },
    sleep: { sleep: selectedSleep ? [selectedSleep] : [] },
    sleepTrend: { sleep: sleepRecords },
    sleepGoal: { goal: {} },
    stepsTrend: { 'activities-steps': allDates.map((date) => ({ dateTime: date, value: steps.get(date) })) },
    caloriesTrend: { 'activities-calories': allDates.map((date) => ({ dateTime: date, value: calories.get(date) })) },
    heartTrend: { 'activities-heart': allDates.map((date) => ({ dateTime: date, value: { restingHeartRate: restingHeart.get(date) } })) },
    metricTrends: { values: allDates.map((date) => ({
      dateTime: date,
      distanceKm: distance.get(date) ?? null,
      floors: floors.get(date) ?? null,
      activeMinutes: activeMinutesFor(date),
      zoneMinutes: zoneMinutes.get(date) ?? null,
      sedentaryMinutes: sedentary.get(date) ?? null,
      hrvMs: hrv.get(date)?.averageMs ?? null,
      breathingRate: breathing.get(date) ?? null,
      spo2: spo2.get(date)?.average ?? null,
      skinTemperature: skinTemp.get(date)?.relative ?? null,
      coreTemperature: coreTemperature.get(date) ?? null,
      cardioScore: cardio.get(date) ?? null,
      sleepEfficiency: sleepByDate.get(date)?.efficiency ?? null,
      bodyFat: bodyFat.get(date) ?? null,
      waterMl: water.get(date) ?? null,
      caloriesIn: nutrition.get(date) ?? null,
    })) },
    bodyWeight: { weight: [...weights].filter(([, weight]) => weight !== null).map(([date, weight]) => ({ date, weight, bmi: null })) },
    bodyFat: { fat: [...bodyFat].filter(([, fat]) => fat !== null).map(([date, fat]) => ({ date, fat })) },
    weightGoal: { goal: {} },
    water: { summary: { water: selected(water, selectedDate) } },
    waterGoal: { goal: {} },
    food: { summary: { calories: selected(nutrition, selectedDate) } },
    breathing: { br: currentBreathing === null ? [] : [{ dateTime: selectedDate, value: { breathingRate: currentBreathing } }] },
    hrv: { hrv: currentHrv === null ? [] : [{ dateTime: selectedDate, value: {
      dailyRmssd: currentHrv.averageMs,
      deepRmssd: currentHrv.deepSleepRmssdMs,
      entropy: currentHrv.entropy,
      nonRemHeartRate: currentHrv.nonRemHeartRate,
    } }] },
    spo2: currentSpo2 === null ? {} : { dateTime: selectedDate, value: {
      avg: currentSpo2.average,
      min: currentSpo2.lowerBound,
      max: currentSpo2.upperBound,
    } },
    skinTemperature: { tempSkin: currentTemp === null ? [] : [{ dateTime: selectedDate, value: {
      nightlyRelative: currentTemp.relative,
      nightlyTemperatureCelsius: currentTemp.nightly,
      baselineTemperatureCelsius: currentTemp.baseline,
      relativeNightlyStddev30dCelsius: currentTemp.stddev30d,
    } }] },
    coreTemperature: { tempCore: currentCoreTemperature === null ? [] : [{ dateTime: selectedDate, value: { coreTemperature: currentCoreTemperature } }] },
    cardio: { cardioScore: currentCardio === null ? [] : [{ dateTime: selectedDate, value: { vo2Max: String(currentCardio) } }] },
    ecg: { ecgReadings },
    activities: { activities },
    identity: raw.identity,
    ...(raw.irnProfileRaw !== undefined || raw.irnAlertsRaw !== undefined
      ? { irregularRhythm: { profile: raw.irnProfileRaw, alerts: raw.irnAlertsRaw } }
      : {}),
    bloodGlucose: raw.glucoseRaw,
    heartRateZones: { values: heartRateZones },
    breathingSleep: { values: breathingSleep },
  }
}

// minutes per HR zone from a metricsSummary; null when the summary has no zone data
function heartZoneMinutes(summary) {
  const zones = summary?.heartRateZoneDurations || {}
  if (!Object.keys(zones).length) return null
  const minutes = (value) => value === undefined || value === null ? null : durationSeconds(value) / 60
  return { light: minutes(zones.lightTime), moderate: minutes(zones.moderateTime), vigorous: minutes(zones.vigorousTime), peak: minutes(zones.peakTime) }
}

// Reconciled exercise intervals carry no civilStartTime (only the GET does), so the civil
// date is start + utc offset.
function civilDateFromOffset(isoTime, utcOffset) {
  if (!isoTime) return null
  const ms = new Date(isoTime).getTime() + durationSeconds(utcOffset) * 1000
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
}

// Google Health Exercise → Session. Google records NO sets/reps/exercise names: strength
// sessions are exerciseType WORKOUT with displayName = muscle group. Sets live in the local
// workouts table, linked by session_id.
// Running form. Google mixes units here — millimetres for distances, a bare ratio, a duration
// string — so normalise to m / % / ms and drop the block entirely when the watch recorded none.
function mobilityForm(m) {
  if (!m) return null
  const form = {
    cadence_spm: numeric(m.avgCadenceStepsPerMinute),
    stride_length_m: numeric(m.avgStrideLengthMillimeters, (v) => v / 1000),
    vertical_oscillation_m: numeric(m.avgVerticalOscillationMillimeters, (v) => v / 1000),
    vertical_ratio_pct: numeric(m.avgVerticalRatio),
    ground_contact_ms: m.avgGroundContactTimeDuration ? durationSeconds(m.avgGroundContactTimeDuration) * 1000 : null,
  }
  return Object.values(form).some((v) => v !== null) ? form : null
}

// A lap/split carries its own metricsSummary. Returning it raw meant callers got millimetre
// integers and "960s" strings while the session above it was already normalised.
function toLap(split) {
  const m = split.metricsSummary || {}
  return {
    start_time: split.startTime ?? null,
    end_time: split.endTime ?? null,
    split_type: split.splitType ?? null,
    active_duration_s: split.activeDuration ? durationSeconds(split.activeDuration) : null,
    distance_m: numeric(m.distanceMillimeters, (v) => v / 1000),
    calories_kcal: numeric(m.caloriesKcal),
    steps: numeric(m.steps),
    avg_hr_bpm: numeric(m.averageHeartRateBeatsPerMinute),
    avg_pace_s_per_m: numeric(m.averagePaceSecondsPerMeter),
  }
}

function toSession(point) {
  const exercise = point.exercise || {}
  const summary = exercise.metricsSummary || {}
  const interval = exercise.interval || {}
  const secs = (value) => value === undefined || value === null ? null : durationSeconds(value)
  const elapsed = (new Date(interval.endTime) - new Date(interval.startTime)) / 1000
  const events = (exercise.exerciseEvents || []).map((event) => ({ time: event.eventTime, type: event.exerciseEventType }))
  const source = point.dataSource // reconcile omits dataSource → null for listed sessions; fetchExerciseSession (dataPoints.get) has it
  return {
    session_id: point.dataPointName ?? point.name,
    date: dateFromCivil(interval.civilStartTime) || civilDateFromOffset(interval.startTime, interval.startUtcOffset),
    start_time: interval.startTime ?? null,
    end_time: interval.endTime ?? null,
    utc_offset_s: secs(interval.startUtcOffset),
    exercise_type: exercise.exerciseType ?? null,
    name: exercise.displayName ?? null,
    active_duration_s: secs(exercise.activeDuration),
    elapsed_s: Number.isFinite(elapsed) ? Math.max(0, elapsed) : null,
    calories_kcal: numeric(summary.caloriesKcal),
    distance_m: numeric(summary.distanceMillimeters, (value) => value / 1000),
    steps: numeric(summary.steps),
    avg_hr_bpm: numeric(summary.averageHeartRateBeatsPerMinute),
    avg_pace_s_per_m: numeric(summary.averagePaceSecondsPerMeter),
    avg_speed_m_s: numeric(summary.averageSpeedMillimetersPerSecond, (value) => value / 1000),
    elevation_gain_m: numeric(summary.elevationGainMillimeters, (value) => value / 1000),
    active_zone_minutes: numeric(summary.activeZoneMinutes),
    hr_zones_min: heartZoneMinutes(summary),
    events,
    // Fitbit emits a terminal PAUSE (no matching RESUME) right before STOP/end-of-events on
    // sessions that were never actually paused — only count pauses that were resumed.
    pauses: events.filter((event, i) => /PAUSE$/.test(event.type) && /RESUME$/.test(events[i + 1]?.type || '')).length,
    // Running-form telemetry the watch records but nothing surfaced until now. Present on
    // walks/runs only; every sub-field is optional even when mobilityMetrics itself exists.
    form: mobilityForm(summary.mobilityMetrics),
    run_vo2_max: numeric(summary.runVo2Max),
    swim_lengths: numeric(summary.totalSwimLengths),
    pool_length_m: numeric(exercise.exerciseMetadata?.poolLengthMillimeters, (value) => value / 1000),
    laps: (exercise.splitSummaries || []).map(toLap),
    splits: (exercise.splits || []).map(toLap),
    notes: exercise.notes ?? null,
    has_gps: exercise.exerciseMetadata?.hasGps === true,
    source: source ? { platform: source.platform ?? null, recording_method: source.recordingMethod ?? null } : null,
    create_time: exercise.createTime ?? null,
    update_time: exercise.updateTime ?? null,
    raw: exercise,
  }
}

// Every exercise session with a civil start in [from, to).
async function fetchExerciseSessions(accessToken, from, to) {
  const listed = await listData(accessToken, 'exercise', 'session', from, to)
  // date is NOT NULL in gh_exercise_sessions — a point with no interval.startTime would otherwise
  // fail the whole batch's upsert transaction and cache nothing for the range (LOW: schema-null-date-aborts-batch).
  return { sessions: dataPoints(listed).map(toSession).filter((session) => session.session_id && session.date) }
}

// Per-point endpoints only accept the "me" alias; reconcile hands back numeric user ids.
const pointName = (sessionId) => /^\d+$/.test(sessionId) ? `users/me/dataTypes/exercise/dataPoints/${sessionId}` : sessionId.replace(/^users\/[^/]+\//, 'users/me/')

// One session via dataPoints.get — the only read that carries dataSource (reconcile omits it),
// so this is how a cached session gets its `source` filled in.
async function fetchExerciseSession(accessToken, sessionId) {
  return toSession(await request(`/${pointName(sessionId)}`, accessToken))
}

// TCX (GPS track + laps) for one session. Only meaningful when has_gps.
function exportExerciseTcx(accessToken, sessionId) {
  return request(`/${pointName(sessionId)}:exportExerciseTcx?alt=media`, accessToken, { raw: true })
}

// grams for a nutrient by name from a nutritionLog.nutrients[] array
function nutrientGrams(nl, names) {
  const arr = nl.nutrients || []
  for (const name of names) {
    const found = arr.find((x) => x.nutrient === name)
    if (found) return numeric(found.quantity?.grams ?? found.quantity?.gramsSum)
  }
  return null
}

// every nutrient present → { NUTRIENT: grams } (items carry grams, rollups gramsSum)
function nutrientMap(nl) {
  return Object.fromEntries((nl.nutrients || []).filter((x) => x.nutrient).map((x) => [x.nutrient, numeric(x.quantity?.grams ?? x.quantity?.gramsSum)]))
}

function civilStartToLocalIso(cst) {
  const date = dateFromCivil(cst)
  if (!date) return { date: null, eatenAt: null }
  const t = cst.time || {}
  const hh = String(t.hours || 0).padStart(2, '0')
  const mm = String(t.minutes || 0).padStart(2, '0')
  const ss = String(t.seconds || 0).padStart(2, '0')
  return { date, eatenAt: `${date}T${hh}:${mm}:${ss}` }
}

// Full nutrition history for [from, to): per-day macro totals + individual food items.
// The rollup's nutrients[] is sparse (live: only PROTEIN/DIETARY_FIBER/SODIUM even when the
// day's items carry SUGAR/SATURATED_FAT/…), so per-day totals are the rollup where it speaks
// and the sum of that day's items otherwise — keeps get_nutrition_intake and get_food_log agreeing.
async function fetchNutritionLog(accessToken, from, to) {
  const listed = await listData(accessToken, 'nutrition-log', 'interval', from, to, 'all-sources', 'reconcile')
  const items = (listed.dataPoints || []).map((pt) => {
    const nl = pt.nutritionLog || {}
    const { date, eatenAt } = civilStartToLocalIso(nl.interval?.civilStartTime)
    return {
      item_key: pt.dataPointName || pt.name,
      date,
      eaten_at: eatenAt,
      food_name: nl.foodDisplayName || 'Unnamed food',
      meal_type: nl.mealType || null,
      calories: numeric(nl.energy?.kcal ?? nl.energy?.kcalSum),
      protein: nutrientGrams(nl, ['PROTEIN']),
      carbs: numeric(nl.totalCarbohydrate?.grams) ?? nutrientGrams(nl, ['CARBOHYDRATES', 'TOTAL_CARBOHYDRATE']),
      fat: numeric(nl.totalFat?.grams) ?? nutrientGrams(nl, ['TOTAL_FAT', 'FAT']),
      serving_amount: numeric(nl.serving?.amount),
      serving_unit: nl.serving?.foodMeasurementUnitDisplayName ?? null,
      energy_from_fat: numeric(nl.energyFromFat?.kcal),
      fiber: nutrientGrams(nl, ['DIETARY_FIBER']),
      sugar: nutrientGrams(nl, ['SUGAR']),
      sodium: nutrientGrams(nl, ['SODIUM']),
      saturated_fat: nutrientGrams(nl, ['SATURATED_FAT']),
      cholesterol: nutrientGrams(nl, ['CHOLESTEROL']),
      food_ref: nl.food ?? null,
      nutrients: nutrientMap(nl),
    }
  }).filter((r) => r.date && r.item_key)

  const itemSums = {} // date → { NUTRIENT: grams summed over that day's items }
  for (const it of items) {
    const acc = itemSums[it.date] ??= {}
    for (const [k, v] of Object.entries(it.nutrients)) if (v !== null) acc[k] = (acc[k] ?? 0) + v
  }

  const rollup = await dailyRollup(accessToken, 'nutrition-log', from, to)
  const daily = rollupPoints(rollup).map((pt) => {
    const nl = pt.nutritionLog || {}
    const date = dateFromCivil(pt.civilStartTime)
    const nutrients = { ...itemSums[date], ...nutrientMap(nl) } // rollup wins where present
    const g = (name) => nutrients[name] ?? null
    return {
      date,
      calories: numeric(nl.energy?.kcalSum),
      protein: g('PROTEIN'),
      carbs: numeric(nl.totalCarbohydrate?.gramsSum) ?? g('CARBOHYDRATES') ?? g('TOTAL_CARBOHYDRATE'),
      fat: numeric(nl.totalFat?.gramsSum) ?? g('TOTAL_FAT') ?? g('FAT'),
      fiber: g('DIETARY_FIBER'),
      sugar: g('SUGAR'),
      sodium: g('SODIUM'),
      saturated_fat: g('SATURATED_FAT'),
      cholesterol: g('CHOLESTEROL'),
      nutrients,
    }
  }).filter((r) => r.date)

  return { daily, items }
}

// ===== write path (2026-09-02): create/delete only, anonymous-food mode. See WRITE-SPEC.md. =====
// No server-side idempotency (fact 3): every call below creates a brand-new entry — callers
// must not retry a write_* call assuming Google will dedupe it.

// create/patch/batchDelete all return a long-running Operation, not the bare DataPoint (fact 2).
// The new entry's id is at op.response.name, not op.name — losing this unwrap loses the id
// needed to ever delete/reference the entry.
function unwrapOperation(op) {
  const dp = op?.response
  if (!dp?.name) throw new Error('Google Health did not return a data point name for this write.')
  return { name: dp.name, raw: dp }
}

// SessionTimeInterval for nutrition-log/hydration-log: strictly start < end (fact 4) or Google
// 400s with INVALID_TIME_RANGE. Caller passes one `startTime`; `endTime` is synthesized as
// startTime+60s when omitted, matching fact 4's minimal fix for a one-shot "log this now".
// startUtcOffset/endUtcOffset are "Required" in SessionTimeInterval, but Google ACCEPTS a write
// without them and silently defaults the offset to 0 — the entry then shows in the app at the UTC
// wall-clock time, not the user's. A 12:55 CDT water log filed as 17:55. Always send the real offset.
const utcOffsetSeconds = (d) => `${-d.getTimezoneOffset() * 60}s`

function sessionInterval(startTime, endTime) {
  if (!startTime) throw new Error('startTime is required.')
  const start = new Date(startTime)
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid startTime "${startTime}".`)
  let end = endTime ? new Date(endTime) : null
  if (end && Number.isNaN(end.getTime())) throw new Error(`Invalid endTime "${endTime}".`)
  if (end && end <= start) throw new Error('endTime must be after startTime.')
  if (!end) end = new Date(start.getTime() + 60_000)
  return {
    startTime: start.toISOString(),
    startUtcOffset: utcOffsetSeconds(start),
    endTime: end.toISOString(),
    endUtcOffset: utcOffsetSeconds(end),
  }
}

// Anonymous-food nutrition-log create (fact 8). Identified-food mode (referencing a Food
// catalog entry) is out of scope — health-mcp has no food-catalog search tool yet.
async function createNutritionLog(accessToken, {
  startTime, endTime, foodDisplayName, mealType, servingAmount, servingUnit,
  calories, carbsG, fatG, proteinG, fiberG, sugarG, sodiumMg, saturatedFatG, cholesterolMg,
} = {}) {
  const interval = sessionInterval(startTime, endTime)
  const nutrients = []
  // sodium/cholesterol arrive as mg (matching the existing _mg convention); the wire nutrient
  // quantity only has a grams field (no milligrams), so convert here.
  const add = (nutrient, grams) => { if (grams !== undefined && grams !== null) nutrients.push({ nutrient, quantity: { grams } }) }
  add('PROTEIN', proteinG)
  add('DIETARY_FIBER', fiberG)
  add('SUGAR', sugarG)
  add('SODIUM', sodiumMg == null ? sodiumMg : sodiumMg / 1000)
  add('SATURATED_FAT', saturatedFatG)
  add('CHOLESTEROL', cholesterolMg == null ? cholesterolMg : cholesterolMg / 1000)
  // DataPoint is a union — the fields must nest under the type's own key (`nutritionLog`), never
  // sit at the body root, or Google 400s every field as "Unknown name … at 'data_point'".
  const body = {
    nutritionLog: {
      interval,
      foodDisplayName,
      mealType,
      // foodMeasurementUnitDisplayName is readOnly/"Output only" per disc.json — writing there is
      // silently dropped. foodMeasurementUnit is the documented writable field (untested live; fact 8's
      // minimal set didn't exercise a unit, ship it best-effort rather than the field proven inert).
      serving: { amount: servingAmount, ...(servingUnit ? { foodMeasurementUnit: servingUnit } : {}) },
      energy: { kcal: calories },
      totalCarbohydrate: { grams: carbsG },
      totalFat: { grams: fatG },
      nutrients,
    },
  }
  // never send dataSource — omitting it lets Google default recordingMethod to UNKNOWN (fact 6)
  const op = await request('/users/me/dataTypes/nutrition-log/dataPoints', accessToken, { method: 'POST', body })
  return unwrapOperation(op)
}

async function createHydrationLog(accessToken, { startTime, endTime, milliliters } = {}) {
  const interval = sessionInterval(startTime, endTime)
  const op = await request('/users/me/dataTypes/hydration-log/dataPoints', accessToken, {
    method: 'POST',
    body: { hydrationLog: { interval, amountConsumed: { milliliters } } },
  })
  return unwrapOperation(op)
}

// weight uses ObservationSampleTime (a point, not an interval) — fact 5.
async function createWeight(accessToken, { physicalTime, weightGrams, notes } = {}) {
  if (!physicalTime) throw new Error('physicalTime is required.')
  const time = new Date(physicalTime)
  if (Number.isNaN(time.getTime())) throw new Error(`Invalid physicalTime "${physicalTime}".`)
  const op = await request('/users/me/dataTypes/weight/dataPoints', accessToken, {
    method: 'POST',
    // same offset rule as sessionInterval — without utcOffset the sample lands at UTC wall-clock time.
    body: { weight: { sampleTime: { physicalTime: time.toISOString(), utcOffset: utcOffsetSeconds(time) }, weightGrams, ...(notes ? { notes } : {}) } },
  })
  return unwrapOperation(op)
}

// Exercise-session create (2026-09-03). Verified live against the v4 API:
//   - `notes` is free text and round-trips exactly, multi-line included. It is the ONLY field
//     that can carry sets/reps/exercise names — v4 has no repetition/set/weight fields anywhere
//     ("repetition" appears zero times in the discovery doc).
//   - `displayName` is NOT settable. The server overwrites it with a name generated from
//     exerciseType ("Strength training" for STRENGTH_TRAINING). The docs claim exerciseType
//     `OTHER` allows a custom name; live, OTHER is coerced to WORKOUT and the name is discarded.
//     So the session title is chosen by picking the right exerciseType, never by naming it.
//   - metricsSummary (caloriesKcal, averageHeartRateBeatsPerMinute) and activeDuration persist.
const SET_LINE = (e) => {
  const reps = e.sets && e.reps ? `${e.sets}x${e.reps}` : (e.reps ? `${e.reps} reps` : (e.sets ? `${e.sets} sets` : null))
  const load = e.weight_kg != null ? `@${e.weight_kg}kg` : null
  const time = e.duration_min != null ? `${e.duration_min} min` : null
  return [e.name, reps, load, time].filter(Boolean).join(' ')
}

// Sets are rendered to text because that is the only shape Google will store. The structured
// version stays in the local workouts table, which is what get_progress computes 1RM from.
function renderSets(exercises = [], extraNotes) {
  const lines = exercises.map(SET_LINE).filter(Boolean)
  if (extraNotes) lines.push(extraNotes)
  return lines.join('\n') || null
}

async function createExercise(accessToken, {
  startTime, endTime, exerciseType = 'STRENGTH_TRAINING', exercises, notes,
  caloriesKcal, avgHeartRateBpm, activeDurationS,
} = {}) {
  const interval = sessionInterval(startTime, endTime)
  const metricsSummary = {}
  if (caloriesKcal != null) metricsSummary.caloriesKcal = caloriesKcal
  if (avgHeartRateBpm != null) metricsSummary.averageHeartRateBeatsPerMinute = String(Math.round(avgHeartRateBpm))
  const body = {
    exercise: {
      interval,
      exerciseType,
      ...(activeDurationS != null ? { activeDuration: `${Math.round(activeDurationS)}s` } : {}),
      ...(Object.keys(metricsSummary).length ? { metricsSummary } : {}),
      ...(renderSets(exercises, notes) ? { notes: renderSets(exercises, notes) } : {}),
    },
  }
  const op = await request('/users/me/dataTypes/exercise/dataPoints', accessToken, { method: 'POST', body })
  return unwrapOperation(op)
}

// Undo for any of the three write types — one function, the type comes out of `name` itself
// (the segment after dataTypes/ and before /dataPoints/). Allowlisted to the types this write
// surface actually creates — health_metrics_and_measurements.writeonly likely covers the whole
// sample/reconcile family (heart-rate, weight, body-fat, ...), so without this a `name` copied
// from a read tool (e.g. get_heart) could batchDelete real device-synced data this tool never wrote.
const DELETABLE_TYPES = ['nutrition-log', 'hydration-log', 'weight', 'exercise']
async function deleteDataPoint(accessToken, name) {
  const match = /dataTypes\/([^/]+)\/dataPoints\//.exec(name || '')
  if (!match) throw new Error(`Cannot parse a Google Health data type out of "${name}".`)
  if (!DELETABLE_TYPES.includes(match[1])) throw new Error(`Refusing to delete data type "${match[1]}" — only ${DELETABLE_TYPES.join(', ')} can be deleted through this tool.`)
  await request(`/users/me/dataTypes/${match[1]}/dataPoints:batchDelete`, accessToken, {
    method: 'POST',
    body: { names: [name] },
  })
  return { deleted: true, name }
}

module.exports = {
  provider: 'google-health',
  scopes: SCOPES,
  createPkce,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  syncData: syncGoogleHealthData,
  fetchNutritionLog,
  DATA_TYPES,
  fetchExerciseSessions,
  fetchExerciseSession,
  exportExerciseTcx,
  queryDataPoints,
  createNutritionLog,
  createHydrationLog,
  createWeight,
  createExercise,
  deleteDataPoint,
  __test: { translateGoogleHealth, dateFromCivil, durationSeconds, dataFilter, toSession },
}
