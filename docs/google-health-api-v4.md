# Google Health API v4 — reference

Ground truth pulled from the live discovery doc (`GET https://health.googleapis.com/$discovery/rest?version=v4`)
and from live probe calls against this user's account, 2026-09-01/02, window 2026-08-27→2026-09-03.
This is what the API actually offers, not just what `server/google-health-service.cjs` currently uses.

## Methods (27)

| Method | Verb | Path | Scopes |
|---|---|---|---|
| `users.getIdentity` | GET | `v4/{+name}` | activity_and_fitness.readonly, ecg.readonly, health_metrics_and_measurements.readonly, irn.readonly, profile.readonly, settings.readonly, sleep.readonly |
| `users.getProfile` | GET | `v4/{+name}` | profile.readonly |
| `users.updateProfile` | PATCH | `v4/{+name}` | **profile.writeonly** |
| `users.getSettings` | GET | `v4/{+name}` | settings.readonly |
| `users.updateSettings` | PATCH | `v4/{+name}` | **settings.writeonly** |
| `users.getIrnProfile` | GET | `v4/{+name}` | irn.readonly |
| `users.pairedDevices.list` / `.get` | GET | `v4/{+parent}/pairedDevices`, `v4/{+name}` | settings.readonly |
| `users.dataTypes.dataPoints.list` | GET | `v4/{+parent}/dataPoints` | matching `*.readonly` (per family) |
| `users.dataTypes.dataPoints.reconcile` | GET | `v4/{+parent}/dataPoints:reconcile` | matching `*.readonly` |
| `users.dataTypes.dataPoints.get` | GET | `v4/{+name}` | matching `*.readonly` |
| `users.dataTypes.dataPoints.create` | POST | `v4/{+parent}/dataPoints` | **matching `*.writeonly`** |
| `users.dataTypes.dataPoints.patch` | PATCH | `v4/{+name}` | **matching `*.writeonly`** |
| `users.dataTypes.dataPoints.batchDelete` | POST | `v4/{+parent}/dataPoints:batchDelete` | **matching `*.writeonly`** |
| `users.dataTypes.dataPoints.dailyRollUp` | POST | `v4/{+parent}/dataPoints:dailyRollUp` | readonly (+ writeonly for write-only types) |
| `users.dataTypes.dataPoints.rollUp` | POST | `v4/{+parent}/dataPoints:rollUp` | same as reconcile |
| `users.dataTypes.dataPoints.exportExerciseTcx` | GET | `v4/{+name}:exportExerciseTcx` | activity_and_fitness.readonly, location.readonly |
| `projects.subscribers.{create,list,patch,delete}` | — | `v4/{+parent}/subscribers`, `v4/{+name}` | **cloud-platform** |
| `projects.subscribers.subscriptions.{create,list,patch,delete}` | — | `v4/{+parent}/subscriptions`, `v4/{+name}` | **cloud-platform** |
| `shl.m.getShlManifest` | POST | `v4/shl/m/{externalShlId}` | (SMART Health Links — unrelated to fitness data) |
| `shl.r.get` | GET | `v4/shl/r/{externalShlId}/{resourceToken}` | (SMART Health Links) |

> **Live-tested caveat on `batchDelete`/`patch` (2026-09-04):** `batchDelete` only succeeds on data points
> the calling OAuth client itself wrote (`dataSource.platform == GOOGLE_WEB_API`, matched to the client's
> own `googleWebClientId`) — on a data point from another app (e.g. `platform: "FITBIT"`, from the Fitbit
> app) it returns HTTP 403 reported as `"Invalid argument in request: names"`, a permission error disguised
> as a malformed-argument one. `dataPoints.patch` on `nutrition-log` returns HTTP 500 in practice on every
> body shape tried, partial or full, and there's no `updateMask` parameter at all. Full write-up:
> `docs/agent-food-logging-write-apis.md` §10.

**The corrected claim:** Google Health v4 is NOT read-only. `create` / `patch` / `batchDelete` exist for
every writeable data type, gated behind that data type's `*.writeonly` OAuth scope (a *different* scope
than the `*.readonly` one this server requests). OpenVitals is read-only **by choice of scope**, not
because the API lacks writes.

## Data types (42)

`DataPoint` (the discovery doc's point-container message) has 44 properties; subtract `name` and
`dataSource` (metadata, not a type) → 42 data types. `server/google-health-service.cjs`'s `DATA_TYPES`
covers all 42.

| kind | op | listable | write-only (list/reconcile → 400, create/patch/batchDelete only) |
|---|---|---|---|
| `sample` | reconcile | heart-rate, heart-rate-variability, oxygen-saturation, weight, body-fat, height, blood-glucose, core-body-temperature, vo2-max, run-vo2-max, respiratory-rate-sleep-summary | **symptoms, moods, ovulation-test** |
| `interval` | reconcile | steps, distance, floors, altitude, active-minutes, active-zone-minutes, active-energy-burned, basal-energy-burned, sedentary-period, time-in-heart-rate-zone, activity-level, swim-lengths-data | **menstrual-period** |
| `session` | reconcile | exercise, nutrition-log, hydration-log, sleep | — |
| `session` | list | electrocardiogram, irregular-rhythm-notification | — |
| `daily` | reconcile | daily-resting-heart-rate, daily-heart-rate-variability, daily-oxygen-saturation, daily-respiratory-rate, daily-sleep-temperature-derivations, daily-vo2-max, daily-heart-rate-zones | — |
| `catalog` | list (no time filter) | food, food-measurement-unit | — |

Write-only types 400 with `"List/Reconcile is not supported for data type X, but the following actions
are supported: create, update, batchDelete"` — confirmed live for `symptoms`, `moods`, `menstrual-period`,
`ovulation-test`.

### Did this user's account have data, Aug 27 → Sep 3 2026?

| Type | Had data | Notes |
|---|---|---|
| exercise | ✅ 22 sessions | mixed WORKOUT (strength) + WALKING/other |
| nutrition-log | ✅ 12 items | one day sampled |
| hydration-log | — (0) | empty `dataPoints` |
| food (catalog) | ✅ 20 | user's saved food catalog |
| height | ✅ 1 | |
| heart-rate-variability | ✅ 20 | |
| oxygen-saturation | ✅ 5 | |
| time-in-heart-rate-zone | ✅ 20 | |
| daily-heart-rate-zones | ✅ 7 | one row/day |
| active-energy-burned | ✅ 20 | |
| swim-lengths-data | ✅ 20 | had swim workouts |
| respiratory-rate-sleep-summary | ✅ 6 | |
| activity-level | ✅ 20 | (only errors with a bad filter member, see below) |
| active-zone-minutes | ✅ 20 | |
| sedentary-period | ✅ 20 | |
| weight, body-fat, basal-energy-burned, run-vo2-max, vo2-max, altitude, floors | — (0) | empty body, no `dataPoints` key |
| symptoms, moods, menstrual-period, ovulation-test | n/a | write-only, 400 on read regardless of data |
| sleep | n/a in this probe | reconcile with a `civil_start_time` filter 400s — **must** use `civil_end_time` (see filter grammar) |

## Filter grammar (by kind)

`filter` param, one member comparison, snake_case type name (`heart-rate` → `heart_rate`):

| kind | member | example |
|---|---|---|
| sample | `<type>.sample_time.civil_time` | `weight.sample_time.civil_time >= "2026-08-27" AND weight.sample_time.civil_time < "2026-09-03"` |
| interval / most sessions | `<type>.interval.civil_start_time` | `exercise.interval.civil_start_time >= "2026-08-19" AND … < "2026-09-03"` |
| daily | `<type>.date` | `daily-heart-rate-zones.date >= "2026-08-27" AND … < "2026-09-03"` |
| sleep (session, exception) | `sleep.interval.civil_end_time` | civil_start_time on sleep 400s: `INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER` |
| electrocardiogram (session, exception) | `electrocardiogram.interval.start_time` (physical, lower bound only, `list` not `reconcile`) | `electrocardiogram.interval.start_time >= "2026-06-04T00:00:00Z"` — trim the upper bound client-side |
| catalog | none | no time filter at all; plain `list` |

`activity-level` 400s on its default `interval.civil_start_time` member in one probe call (a filter typo in
that particular probe request, not a data-type quirk — the same member works via `reconcile` in the other
probe) — worth a smoke-test if this type misbehaves again. `dataSourceFamily=users/me/dataSourceFamilies/all-sources`
is required on every `reconcile` call. Rate limit: 300 req/min (`waitForApiSlot` already handles this).

## `Exercise` field inventory

Top-level: `interval` {startTime, endTime, startUtcOffset, endUtcOffset, civilStartTime, civilEndTime},
`exerciseType`, `displayName`, `activeDuration` (duration string, e.g. `"997s"`), `metricsSummary`,
`exerciseEvents[]` ({eventTime, eventUtcOffset, exerciseEventType: START|STOP|PAUSE|RESUME|AUTO_PAUSE|AUTO_RESUME}),
`splits[]`, `splitSummaries[]` (laps), `notes`, `exerciseMetadata` ({hasGps, poolLengthMillimeters}),
`createTime`, `updateTime`.

`metricsSummary` (`MetricsSummary`): `caloriesKcal`, `distanceMillimeters`, `steps` (string),
`averagePaceSecondsPerMeter`, `averageSpeedMillimetersPerSecond`, `averageHeartRateBeatsPerMinute` (string),
`heartRateZoneDurations` {lightTime, moderateTime, vigorousTime, peakTime — duration strings},
`activeZoneMinutes` (string), `elevationGainMillimeters`, `runVo2Max`, `totalSwimLengths`, `mobilityMetrics`.

**No sets, reps, weight, or exercise name anywhere in this schema.** `exerciseType: "WORKOUT"` +
`displayName` = muscle group (`"Back"`, `"Chest"`, `"Leg"`, `"Arms"`, `"Shoulders"`) is the entire
representation of a strength session. `list_exercise_sessions` / `get_exercise_session` link the local
`workouts` rows (which DO have sets/reps/weight) to a session via `workouts.session_id`.

## `NutritionLog` field inventory

`foodDisplayName`, `mealType` (BEFORE_BREAKFAST|BREAKFAST|BEFORE_LUNCH|LUNCH|BEFORE_DINNER|DINNER|
AFTER_DINNER|SNACK|ANYTIME), `energy.kcal`, `energyFromFat.kcal`, `totalFat.grams`,
`totalCarbohydrate.grams`, `nutrients[]` (array of `NutrientQuantity` {nutrient, quantity.grams}),
`serving` {amount, foodMeasurementUnitDisplayName}, `food` (resource ref into the food catalog),
`interval` (civilStartTime + civilEndTime — a nutrition-log entry is a session, not a sample).

`nutrient` enum has 39 members (`NUTRIENT_UNSPECIFIED` + 38 real ones): BIOTIN, CAFFEINE, CALCIUM,
CHLORIDE, CARBOHYDRATES, CHOLESTEROL, CHROMIUM, COPPER, DIETARY_FIBER, FOLIC_ACID, IODINE, IRON,
MAGNESIUM, MANGANESE, MOLYBDENUM, MONOUNSATURATED_FAT, NIACIN, PANTOTHENIC_ACID, PHOSPHORUS,
POLYUNSATURATED_FAT, POTASSIUM, PROTEIN, RIBOFLAVIN, SATURATED_FAT, SELENIUM, SODIUM, SUGAR, THIAMIN,
TRANS_FAT, UNSATURATED_FAT, VITAMIN_A, VITAMIN_B12, VITAMIN_B6, VITAMIN_C, VITAMIN_D, VITAMIN_E,
VITAMIN_K, ZINC, FOLATE. This account's live data has used CALCIUM, CARBOHYDRATES, CHOLESTEROL,
DIETARY_FIBER, IRON, PROTEIN, SATURATED_FAT, SODIUM, SUGAR, VITAMIN_A, VITAMIN_C so far — the rest are
schema-legal but unseen. `queryDataPoints('nutrition-log', …)` / `get_food_log`'s `nutrients` object
passes through whatever a given item actually carries.

## Feature roadmap

Ranked by value, not effort — each needs something OpenVitals doesn't have today.

| # | Feature | What it needs | Notes |
|---|---|---|---|
| 1 | **Writes into Google Health** — log meals/water/weight/moods/symptoms from chat, have them show up in Google Health/Fit | Re-consent with `*.writeonly` scopes for the relevant families (nutrition, health_metrics_and_measurements, mindfulness, reproductive_health, logged_symptoms); a product decision, since this is a **public** OSS project shipping read-only scopes on purpose | `create`/`patch`/`batchDelete` already exist server-side, this is scope + a thin wrapper, no new API surface |
| 2 | **Push subscriptions instead of polling** | A GCP project with billing + the `cloud-platform` scope (separate consent from the googlehealth.* scopes); `projects.subscribers` + `projects.subscribers.subscriptions` | Webhook-driven sync instead of `sync_google_health` polling; heavier setup (GCP project, not just OAuth) |
| 3 | **User's Google food catalog as a search source** | Nothing new — `food` (catalog kind) is already in `DATA_TYPES`, reachable via `query_google_health({data_type:'food'})` | Wire it into `search_food` as a source alongside the existing food-search backend; catalog has no time filter, just `list` |
| 4 | **Per-minute series via `query_google_health`** | Nothing new — already generic-readable | `active-energy-burned`, `activity-level`, `time-in-heart-rate-zone`, `swim-lengths-data` (strokes) are `interval` kind at whatever resolution Google stored them; not yet surfaced as a dedicated tool/chart, just the raw escape hatch |
| 5 | **TCX → GPX/map** | A TCX→GPX converter (small, no new API access) | `export_exercise_tcx` already returns the XML; GPX conversion + a map-friendly summary (route bounds, elevation profile) is pure post-processing |
