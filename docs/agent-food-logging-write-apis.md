# Agent food/water/weight/workout logging — write-API research

Synthesis of three researcher passes, 2026-09-02. Ground truth preferred over researcher memory:
`disc.json` = live Google Health v4 discovery doc fetched this session; official `developers.google.com/health/*`
pages, dated. Anything a researcher flagged UNVERIFIED stays UNVERIFIED here — do not treat it as settled.

## 1. TL;DR

**Recommended path: extend health-mcp's existing Google Health v4 OAuth, don't add a new vendor.**
health-mcp already talks to the exact API that has full write support for nutrition, hydration, and weight.
This is a scope-and-code change, not a new integration.

- Scope change: add `googlehealth.nutrition.writeonly` (food + hydration writes) and
  `googlehealth.health_metrics_and_measurements.writeonly` (weight writes) to the `SCOPES` array in
  `server/google-health-service.cjs` (currently all-`.readonly`, see §7).
- Re-consent: any new scope forces a **fresh OAuth consent screen** — Google shows the user a new grant
  dialog for just the added scope(s) (incremental authorization); existing `.readonly` grants are kept,
  no re-approval needed for those. [developers.google.com/health/scopes, last_updated 2026-08-27]
- Write call: `POST https://health.googleapis.com/v4/{parent=users/*/dataTypes/*}/dataPoints` with a
  `DataPoint` body carrying `nutritionLog` / `hydrationLog` / `weight`. Returns a long-running Operation.
  [developers.google.com/health/data-types/nutrition, last_updated 2026-08-25]
- Ceiling worth knowing up front: writes land in their **own DataSource** (`platform: GOOGLE_WEB_API`),
  separate from watch-synced data; whether they visibly merge into the Fitbit/Google Health app UI is
  **UNVERIFIED** (only indirectly implied by the "Reconciled Stream" description — see §2 gotchas, §8).
- Restricted-scope gate: every Google Health scope is classified Restricted → OAuth app verification +
  an annual third-party CASA security assessment ($500–$4,500, 2–6 weeks) is required once OpenVitals
  is used by >100 people; irrelevant for Saiteja's own single-user use today.
  [developers.google.com/health/app-verification, last_updated 2026-08-17]

## 2. Google Health v4 writes — data types relevant here

Ground truth: `disc.json` (live discovery doc) + `developers.google.com/health/data-types*` pages.
Endpoint shape is the same for every type: `POST v4/{parent}/dataPoints` (create), `PATCH v4/{name}` (patch),
`POST v4/{parent}/dataPoints:batchDelete` (delete, max 10,000 names/request — confirmed in
`BatchDeleteDataPointsRequest` schema description in disc.json).

| Data type | Writable? | Create body (top-level field) | Scope | Gotchas |
|---|---|---|---|---|
| `nutrition-log` | Yes | `nutritionLog` | `googlehealth.nutrition.writeonly` | Two mutually exclusive modes: anonymous food (inline `foodDisplayName`+`nutrients[]`+`energy`) is **not editable after creation** — right conclusion, wrong reason (see §10, F3): `dataPoints.patch` exists in the API surface but returns HTTP 500 on every nutrition-log call tried, partial or full body, with no `updateMask` param at all — so batchDelete+recreate is the only path that actually works, not a documented restriction; identified food (`food` = resource-name ref) auto-populates nutrients server-side, client can't set them. |
| `food` | **No — read-only** | — | — | `/health/data-types` table lists `list, get` only. You cannot register custom Food catalog entries; anonymous-food nutrition-log is the only path for a food not in Google's DB. |
| `food-measurement-unit` | **No — read-only** | — | — | Same as above; referenced from `Serving.foodMeasurementUnit`. Exact reference-string format is UNVERIFIED (no populated example found). |
| `hydration-log` | Yes | `hydrationLog` | `googlehealth.nutrition.writeonly` (same scope as food) | Mutable via PATCH (unlike nutrition-log). `amountConsumed.milliliters` is canonical; `userProvidedUnit` (e.g. `FLUID_OUNCE_US`) is display-only metadata, **not converted server-side** — client must pre-convert to ml itself. |
| `weight` | Yes | `weight` | `googlehealth.health_metrics_and_measurements.writeonly` (inferred; no explicit per-schema scope map published — UNVERIFIED) | `weightGrams` required, in grams, no unit field to set — client converts. No official worked create example found (schema-derived, not doc-confirmed). |
| `exercise` | Yes | `exercise` | `googlehealth.activity_and_fitness.writeonly` | **No sets/reps/weight-per-set fields anywhere in the schema** — only session-level `exerciseType`, `displayName`, `interval`, `metricsSummary` (avg HR, calories, VO2max — no strength fields), `splitSummaries`. Free-text `notes` string is the only place to stuff structured set data, and nothing renders it as sets/reps anywhere in Google Health. |
| `symptoms` / `moods` | Not researched this pass | — | (`logged_symptoms.writeonly` per disc.json scope list, unconfirmed mapping) | Out of scope for this research round — flag for a follow-up pass if needed. |

**Default `dataSource`/`recordingMethod` inconsistency (flag, not a bug you can fix):** two official examples
disagree on what Google assigns when a client omits `dataSource` on create — `recordingMethod: UNKNOWN` in
the `/health/data-types/nutrition` examples vs. `ACTIVELY_MEASURED` in the `/health/endpoints` "Log a food
item" example, for what looks like the same request shape. Omit `dataSource` and let Google populate it;
only set `dataSource.recordingMethod: MANUAL` if you need to assert manual entry explicitly.

**Client-supplied `name` (data-point-id):** disc.json's `DataPoint.name` description documents a format rule
(4–63 chars, lowercase alnum + hyphen) for when a client ID is accepted, but **no official create example for
any of these types shows a client supplying `name`** — every example shows server-generated IDs. Whether
`create()` actually honors a client-chosen name for nutrition-log/hydration-log/weight is **UNVERIFIED**.
Do not build idempotency/dedupe logic around an assumed name-collision behavior (ALREADY_EXISTS is not in
the official Error Catalog either — see §8) without a live test against the real API.

### Worked example — "1 cup Chicken Dum biryani, DINNER"

**(a) Identified food** (references an existing Food catalog entry — the normal path when a search hit exists):

```json
POST https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints
{
  "nutritionLog": {
    "interval": { "startTime": "2026-09-02T19:30:00Z", "endTime": "2026-09-02T19:30:00Z" },
    "food": "users/me/dataTypes/food/dataPoints/foods/{food-id}",
    "mealType": "DINNER",
    "serving": { "amount": 1 }
  }
}
```
All nutrient/energy fields are populated server-side from the referenced Food entry — the client cannot
set them in this mode. `{food-id}` must come from a `GET users/me/dataTypes/food/dataPoints` (note the `/foods/` path segment — that is the exact form Google returned on this account's live nutrition-log items, e.g. `…/food/dataPoints/foods/2786799937787671720`)
list/search call (read-only, no write scope needed for the lookup itself).

**(b) Anonymous / custom food** (no matching catalog entry — biryani is a strong candidate for this path
since Google's Food catalog is US-chain-and-generic-food heavy, not verified against it this session):

```json
POST https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints
{
  "nutritionLog": {
    "interval": { "startTime": "2026-09-02T19:30:00Z", "endTime": "2026-09-02T19:30:00Z" },
    "foodDisplayName": "Chicken Dum Biryani",
    "mealType": "DINNER",
    "serving": { "amount": 1 },
    "nutrients": [
      { "nutrient": "PROTEIN", "quantity": { "grams": 25 } },
      { "nutrient": "SODIUM", "quantity": { "grams": 0.7, "userProvidedUnit": "MILLIGRAM" } }
    ],
    "energy": { "kcal": 450 },
    "totalCarbohydrate": { "grams": 55 },
    "totalFat": { "grams": 15 }
  }
}
```
`WeightQuantity` has only `grams` + `userProvidedUnit` — there is no `milligrams` field, so trace nutrients are sent in grams with the unit hint. Nutrient values above are illustrative placeholders, not looked-up figures — pair this call with a lookup/NL
API (§4) to fill real numbers. `energy.kcal`, `totalCarbohydrate.grams`, `totalFat.grams` are required per
the anonymous-food contract (§2 table); **this entry cannot be edited after creation**, only deleted
(`batchDelete`) and recreated.

## 3. Alternatives ranked (non-Google platforms)

| Platform | Write endpoint | Auth | Cost | 2026 status | Verdict |
|---|---|---|---|---|---|
| **Fitbit Web API** | `POST /1/user/-/foods/log.json` | OAuth2 | free | **Hard shutdown Sept 2026**, new registrations already closed [support.google.com/googlehealth/thread/437070658; developers.google.com/health/migration] | Do not build on it — same vendor (Google) is turning it off in this project's ship window. |
| **FatSecret Platform API** | `food_entry.create` | OAuth1 or OAuth2, 3-legged, per-user consent | Basic tier free, 5,000 calls/day, US-only data [platform.fatsecret.com/api-editions] | Actively maintained through 2026-07/08 | Best non-Google fallback if the user isn't on Google Health. UNVERIFIED whether Basic tier's ToS permits production diary-write use vs. Premier-only. |
| **Nutritionix** | Track API v2 diary endpoints | API key | Official floor: $499/mo Starter (≤200 MAU); a $50/mo "Hobby" tier cited by one independent 2026-03 source is in tension with the official page and may be stale [nutritionix.com/api] | Active | Not "cheap" — only worth it for US restaurant-chain menu coverage, which is otherwise unmatched. |
| **MyFitnessPal** | none official | — | — | Public API deprecated 2019, closed to new partners as of 2026 [rapidevelopers.com; ymove.app] | Only unofficial cookie-session MCPs exist (fragile, off-ToS). Avoid as a primary integration for a public repo. |
| **Cronometer** | none | — | — | No public API, none planned [forums.cronometer.com] | Unofficial MCP hits undocumented mobile endpoints. Avoid. |
| **Lose It!** | partner API (gated) | apply for partnership | free read tier; full read/write reportedly needs user's own Premium subscription (UNVERIFIED per source) | Access by application, not self-serve | Not self-serve enough to build against opportunistically. |
| **MacroFactor** | no cloud API; vendor-sanctioned iOS Shortcuts bridge (`Log by JSON` action) | Shortcuts-local | free | Active, vendor-supported bridge pattern [github.com/MacroFactor/apple-shortcuts] | Only reachable per-device via Shortcuts, not a cloud call. |
| **Yazio / Lifesum** | none official | — | — | No public developer program found for either | Unofficial reverse-engineered MCPs exist only. Avoid. |
| **Samsung Health** | on-device SDK only (`FoodIntake`) | Android partner-app model | — | Samsung is routing third parties to Android Health Connect instead | Not a cloud API; see Health Connect in §5. |
| **Withings** | Partner Hub / OAuth API | OAuth | — | Active, but scoped to device vitals | No evidence of a food-diary write endpoint; UNVERIFIED whether one exists at all. |
| **Garmin Connect+** | none found | — | paid app tier (Jan 2026 feature) | Product feature, not a developer API | No public write endpoint located — UNVERIFIED / likely doesn't exist. |

## 4. Lookup / NL-parsing APIs (accuracy layer for whatever writes the log)

| API | Type | Cost | Notes |
|---|---|---|---|
| **USDA FoodData Central** | Structured lookup | Free (data.gov key) | 1,000 req/hour/IP [reddit.com/r/datasets/comments/1v0dcdp, "verified July 2026"]. Authoritative, US-centric, best default generic-food source. [fdc.nal.usda.gov/api-guide] |
| **Open Food Facts** | Barcode/product lookup, also writable (crowd-contribute) | Free | 10 search req/min, 15 product-read req/min per IP, no monthly cap. Global coverage, crowdsourced quality (weaker than USDA). [openfoodfacts.github.io/openfoodfacts-server/api/] |
| **Edamam** | NL parsing + lookup | Basic $14/mo (100k calls, 50 req/min peak) → Core $69/mo → Plus $299/mo | Mid-cost between free (USDA/OFF) and Nutritionix's $499+ floor. |
| **Nutritionix Natural Language API** | NL parsing (free text → macros) | See §3 pricing | ~85% accuracy on casual food descriptions per one internal test [selfhostednutrition.org, 2026-03]. Differentiator is US restaurant-chain data, not raw parsing. |
| **Passio** | NL/lookup, unverified | Unverified | Only a passing third-party mention found (ymove.app); pricing, auth, write-capability all UNVERIFIED — no primary source consulted. |

Ranked for health-mcp: USDA (free, authoritative) as primary → Open Food Facts for barcode fallback → only
reach for Edamam/Nutritionix if NL-parsing-from-free-text or restaurant-menu accuracy becomes a real gap.

## 5. Sets/reps (workout detail) — ranked options

Google Health v4's `exercise` schema has zero fields for sets/reps/weight-per-set (§2) — none of these
options change that; they're alternatives if structured strength data is a real requirement.

| Option | Fit | Auth/cost | Status | Verdict |
|---|---|---|---|---|
| **Hevy API** | Native `sets:[{type, weight_kg, reps, distance_meters, duration_seconds, rpe, ...}]` per exercise, real REST API (`api.hevyapp.com/v1`) | API key, gated behind Hevy Pro subscription; exact Pro price UNVERIFIED | Docs explicitly warn "no guarantees we won't completely change the structure or abandon the project" — treat as beta [api.hevyapp.com/docs/, last_updated 2026-08-20] | **#1 — only option that both natively models sets/reps and shows up in a real app immediately.** Exact rate limit UNVERIFIED (client libs retry on 429/5xx, confirming a limit exists but no published number). |
| **Strava JSON/FIT strength upload** | Native `sets:[{exercise_type, repetitions, weight, duration, start_time}]`, shipped 2026-05-21 | OAuth2, `activity:write` scope, free | Active [developers.strava.com/docs/changelog/, fetched 2026-09-02] | **#2 — write-only**: a 2026-08-02 Strava community moderator post confirms GET for sets is not supported, only POST — the agent can write sets but can't read them back; user must open the Strava app to see them. |
| **Android Health Connect `ExerciseSegment`** | Has `repetitions`, `weight`, `set index`, RPE per segment — exactly the right fields | On-device Android SDK only, no cloud REST endpoint | Stable (1.1.0, 2026-08-26) | Structurally unlike v4's cloud API — reaching it requires shipping an Android companion app that embeds the Health Connect client; not a net-new capability since data written there just resyncs into Health v4's fieldless `exercise` schema anyway. Only worth it if OpenVitals itself becomes an Android app. |
| **Fitbod** | — | — | No public/developer API found | Not available. |
| **JEFIT** | — | — | No official API; users still requesting one as of April 2026 | Unofficial client hits undocumented private endpoints — fragile, avoid. |
| **Apple HealthKit `HKWorkout`** | No structured set/rep sub-objects at all (aggregate metadata only) | On-device only, no cloud API | — | Same architectural cost as Health Connect, and doesn't even have the fields Health Connect has. |

## 6. Existing MCP servers found (reference implementations)

| Repo | What it covers | Notes |
|---|---|---|
| `github.com/akutishevsky/nutrition-mcp` | Meals (calories/macros/fiber/sugar/caffeine), water, weight logging | Closest direct precedent to health-mcp's goal — 510 commits, latest 2026-08-28, actively developed. Worth reading for MCP-tool-shape ideas. |
| `claudemarketplaces.com/mcp/fliptheweb/fatsecret-mcp` | Wraps FatSecret Platform API | Public search unauthenticated; diary write needs OAuth. |
| `github.com/AdamWalt/myfitnesspal-mcp-python`, `github.com/Mason-Levyy/myfitnesspal-mcp`, `a1dancole/myfitnesspal-mcp` (glama.ai) | MyFitnessPal, unofficial | Cookie/session auth, off-ToS. |
| `@sjawhar/macrofactor-mcp` (npm), `@flokroell/yazio-mcp` | MacroFactor, Yazio, unofficial | Reverse-engineered, no official API to wrap. |
| `claudemarketplaces.com/mcp/rwestergren/cronometer-api-mcp` | Cronometer, unofficial | Hits undocumented mobile REST endpoints. |

Pattern across the ecosystem: wherever a vendor has no official API, the MCP community has already built
an unofficial reverse-engineered bridge — technically reachable, off-ToS and fragile, a maintenance/ToS
liability for a project that's public on GitHub (OpenVitals).

## 7. What to build in health-mcp

Current stored `SCOPES` in `server/google-health-service.cjs` (lines 9-20): all 11 entries are `.readonly`
(activity_and_fitness, health_metrics_and_measurements, nutrition, profile, sleep, ecg, irn, location,
settings, plus openid/profile). None is `.writeonly` today. Adding write scopes is purely additive — no
existing readonly grant needs to change.

| Step | Effort | Notes |
|---|---|---|
| 1. Add `googlehealth.nutrition.writeonly` to `SCOPES`, trigger re-consent, verify the new grant | S | Unlocks food (both anonymous + identified) and hydration-log writes with one scope. |
| 2. Implement `dataPoints.create` for `nutrition-log` (identified + anonymous modes) and `hydration-log` | M | Anonymous-food non-editability (§2) means the tool layer should default to "search food catalog first, fall back to anonymous" rather than always going anonymous. |
| 3. Add `googlehealth.health_metrics_and_measurements.writeonly`, implement `weight` create | S | Same re-consent flow; body is schema-derived, no official worked example exists — test against the live API before shipping (weightGrams, sampleTime.physicalTime/utcOffset). |
| 4. Wire a lookup API for nutrient accuracy on anonymous-food entries | M | USDA FoodData Central first (free); Open Food Facts for barcode fallback. Skip Nutritionix/Edamam unless restaurant-menu accuracy becomes a stated requirement — not free, and this is a personal project. |
| 5. Exercise-session write (`googlehealth.activity_and_fitness.writeonly`) | S–M | Only creates the session shell (type/interval/muscle-group) — does **not** solve sets/reps (no fields exist). Sets/reps stay in health-mcp's local `workouts` table as already designed; skip Hevy/Strava integration unless the user explicitly wants sets to also show up in a third-party app. |
| 6. Live-test client-supplied `name` and duplicate-create behavior before relying on any idempotency assumption | S | §2/§8 — this is genuinely unknown from docs; a 10-minute manual test against the real API resolves it cheaply. |

**Public-repo / OAuth implications:** OpenVitals is public on GitHub. Every Google Health scope — read or
write — is classified Restricted, requiring OAuth app verification + an annual third-party CASA security
assessment ($500–$4,500, 2–6 weeks) once the app serves >100 users; below that, an unverified app is capped
at 100 users and ~2.5 QPS/user (vs. 5 QPS/user verified). [developers.google.com/health/app-verification,
developers.google.com/health/rate-limits] For Saiteja's own single-user use this is a non-issue; it only
becomes a real gate if OpenVitals is opened to other users. Also required regardless of user count: an
in-app disclosure statement in the recommended form "{App name} collects health and fitness data to enable
{feature}, {feature}, and {feature}."

## 8. Unverified (carried over verbatim from researchers — do not treat as settled)

- Whether API writes actually render inside the Fitbit app / Google Health app UI — only indirectly implied
  by the "Reconciled Stream" description on `/health/about` and a secondhand press report (9to5google,
  2026-05-27) of a roadmap bug-fix item; no first-party statement confirms this for write-created data.
- Exact reference-string format for `Serving.foodMeasurementUnit` (inferred by analogy with
  `NutritionLog.food`'s pattern, no populated example found).
- Default `dataSource.recordingMethod` on a bare create — two official examples disagree (`UNKNOWN` vs
  `ACTIVELY_MEASURED`).
- Scope-name discrepancy: the `dataPoints.create` method-reference page lists unsuffixed scope names
  (e.g. `googlehealth.nutrition`) vs. the suffixed `.writeonly` forms in `/health/scopes` and disc.json —
  treated the suffixed/disc.json form as authoritative; the discrepancy itself is unresolved.
- No dedicated GitHub sample repo or client-library code sample for writing nutrition was located (only
  docs-embedded HTTP examples) — a more targeted search might surface one.
- Exact per-dataType scope mapping for Weight/HydrationLog — inferred as
  `health_metrics_and_measurements.writeonly`, not confirmed by an explicit per-schema table.
- Whether FatSecret's free Basic tier permits production/commercial diary-write use, or is implicitly
  Premier-only — not stated on the fetched pricing page.
- Nutritionix's actual cheapest tier for a small project — official page shows a $499/mo floor and states
  non-commercial free trials are no longer offered; a $50/mo "Hobby" tier from an independent 2026-03 source
  is in tension with this and may be stale.
- Whether Withings' API exposes any food/nutrition-diary write endpoint — none found; API appears scoped to
  device vitals only.
- Whether Garmin Connect(+) exposes any public developer write API for food/nutrition — only a product
  feature announcement (Jan 2026) was found, not a developer-facing endpoint.
- Passio's pricing, auth model, and write-capability — only a passing third-party mention found.
- Hevy's exact rate limit (a limit clearly exists — clients retry on 429/5xx — but no published number) and
  exact Hevy Pro subscription price.
- Strava's exact numeric rate limits for the newer Standard/Extended Access tiering (mentioned in an August
  2026 community thread, not independently confirmed).
- Exercise/symptoms/moods data types were not researched in this pass beyond what disc.json's scope list
  implies — flag for a follow-up if health-mcp wants those.

## 9. Settled by live testing (2026-09-02)

A live write+delete round-trip against the real Google Health API this session (not a doc read, an actual
`dataPoints.create`/`batchDelete` call) settled two items that §8 previously carried as unverified:

- **Client-supplied `name` on create is silently ignored.** Two `dataPoints.create` calls with an identical
  requested `name` (`.../dataPoints/smoke-test-<x>`) both returned 200 — Google assigned its own distinct
  numeric ids (`2512638953894064636`, `5481613234006627117`) each time. No error, no collision.
- **There is no server-side dedupe/idempotency.** Repeating an otherwise-identical create call (same
  content, same or different `name`) creates a brand-new entry every time — no 409, no silent overwrite,
  no "already exists" behavior of any kind. `log_meal_to_google_health` / `log_water_to_google_health` /
  `log_weight_to_google_health` document this plainly: calling one twice for the same thing logs it twice.

## 10. Settled by live testing (2026-09-04) — the update/delete ceiling

A second live round, targeted at "update a nutrition-log entry" and "delete a Fitbit-logged entry",
settled the update/delete ceiling for nutrition-log data points.

**Headline: batchDelete/patch/replace only work on data points the calling OAuth client itself wrote.**
An entry's `dataSource.platform` says who wrote it — `GOOGLE_WEB_API` (this server, keyed off
`dataSource.application.googleWebClientId`) is the only platform this server can delete or replace.
Entries logged from the Fitbit app come back `platform: "FITBIT"` and are permanently read-only to this
server — no scope, no request shape, no retry changes that.

- **F3 — `dataPoints.patch` on `nutrition-log` is broken server-side, not just "unsupported."** A partial-
  body PATCH returns HTTP 500. A full-body PATCH (every field re-sent) also returns HTTP 500. There is no
  `updateMask` query parameter at all — passing one returns HTTP 400 `"Unknown name updateMask"`. No body
  shape tried produces a working PATCH for nutrition-log. "Update an entry" can only be implemented as
  create-new + delete-old. Never add a PATCH call for nutrition-log.
- **F4 — batchDelete only works on data points this OAuth client wrote.** Google tags every data point with
  `dataSource.platform` (`GOOGLE_WEB_API` for this server's own writes) and, for `GOOGLE_WEB_API` entries,
  `dataSource.application.googleWebClientId`. Calling batchDelete on a `FITBIT`-platform entry (logged from
  the Fitbit app, not this server) returns **HTTP 403** with the body `"Invalid argument in request:
  names"` — a permission error wearing a malformed-argument error's message. This is the exact bug the
  user hit trying to delete a Fitbit-logged meal.
- **F5 — batchDelete of a well-formed but non-existent name is a silent 200, not a 404.** It returns
  `{"done":true}` with no `response.dataPoints` key at all. A real delete returns
  `{"done":true,"response":{"dataPoints":[{"name":"..."}]}}`. "Did it actually delete" has to be read off
  whether `response.dataPoints` is present, never off the HTTP status — 200 means nothing on its own.
- **F6 — `dataPoints.get` (`GET /v4/{name}`) does return `dataSource`.** Both `platform` and, for this
  server's own entries, `application.googleWebClientId` come back on a plain get. This is the cheap
  pre-flight for "did we write this entry, and can we therefore touch it" before attempting a delete or
  replace. Unlike batchDelete (F5), a get on an already-deleted name **does** return HTTP 404 — so a
  second delete of the same entry surfaces there, and `deleteDataPoint` reports it the same soft way it
  reports F5's no-op (`deleted: false`), never as a hard error.
- **F7 — malformed/empty `names` fail differently, and neither is the 403 above.** A structurally invalid
  name (wrong segment count/shape) returns HTTP 400 with `"Invalid names format. Expected:
  users/{userId}/dataTypes/{dataTypeId}/dataPoints/{dataPointId}"`. An empty or missing `names` array
  returns HTTP 400 with `"Invalid argument in request: names"` — the same string F4's 403 uses, but at a
  different HTTP status and for a different reason (empty array vs. wrong-owner data point). Don't use the
  error string alone to distinguish these cases; check the HTTP status first.
- **F8 — identified-food entries can never be faithfully recreated by this server.** An entry with
  `nutritionLog.food` set (a reference into Google's food catalog, e.g.
  `users/me/dataTypes/food/dataPoints/foods/4360703919455117728`) has its nutrients populated server-side —
  a client cannot set them, on create or otherwise. This server only ever creates anonymous-food entries
  (inline `foodDisplayName` + `nutrients` + `energy`), so an identified-food entry has no equivalent create
  call to recreate it with. On this account, every identified-food entry observed was also platform
  `FITBIT` — F4 and F8 compound rather than being independent risks in practice.

Net effect on "update a meal": a replace (create-new + delete-old) works only when the original entry is
both anonymous-food *and* `GOOGLE_WEB_API`-platform — i.e. only for entries this server itself wrote via
`log_meal_to_google_health`. Anything logged from the Fitbit app, or any identified-food entry regardless
of source, is display-only from here on.
