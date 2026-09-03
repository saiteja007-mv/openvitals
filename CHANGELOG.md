# Changelog

All notable changes to OpenVitals (health-mcp). Dates are the day the work landed on `main`.

## [0.4.0] — 2026-09-03

### Added
- **Workout writing.** `log_workout_to_google_health` creates a real exercise session in the Google Health /
  Fitbit app and stores the structured sets locally in one call, linked by `session_id`. New scope
  `googlehealth.activity_and_fitness.writeonly`.
- **Deeper workout reads.** Sessions now surface running form (`form`: cadence, stride length, vertical
  oscillation, vertical ratio, ground-contact time), `run_vo2_max`, `swim_lengths` and `pool_length_m`, all
  of which the watch records and the server previously dropped. Laps/splits are normalised to the same
  units as the session (metres, seconds) instead of being returned as raw millimetre integers and `"960s"`
  strings.

### Known API limits (verified live, not assumptions)
- **Google Health v4 has no sets, reps, weights or exercise names.** `repetition` appears zero times in the
  discovery doc; the only `segment` fields belong to Sleep; v4beta/v5/v4alpha do not exist. Sets are
  therefore rendered into the session's free-text `notes` — the only field that will carry them — while the
  structured version stays in the local `workouts` table, which is what `get_progress` computes 1RM from.
- **A session's title cannot be set.** `displayName` is overwritten server-side from `exerciseType`
  (`STRENGTH_TRAINING` → "Strength training"). The API docs state that `exerciseType: OTHER` permits a
  custom free-form name; live, `OTHER` is silently coerced to `WORKOUT` and the supplied name is discarded.
  Pick the title by choosing the right `exerciseType`.

## [0.3.1] — 2026-09-03

### Fixed
- **Writes landed at UTC wall-clock time.** `SessionTimeInterval.startUtcOffset`/`endUtcOffset` and
  `ObservationSampleTime.utcOffset` are documented as required but Google accepts a write without them and
  silently defaults the offset to 0 — a 12:55 CDT water log filed as 17:55 in the app. All three write
  paths now send the real local offset; tests assert it.

### Changed
- **Local-only tools now say so.** `log_meal`, `log_hydration` and `upsert_body_metric` write to this
  server's SQLite database and never reach the Google Health / Fitbit app, but their descriptions did not
  say that — so "log 750ml of water" naturally selected `log_hydration` and the entry never appeared in the
  app. Each now states it is local-only and names the `*_to_google_health` tool to use instead.

## [0.3.0] — 2026-09-03

### Added
- **Google Health write path.** `log_meal_to_google_health`, `log_water_to_google_health`,
  `log_weight_to_google_health` write nutrition-log/hydration-log/weight data points to the user's real
  Google Health/Fitbit account under the new `.writeonly` scopes; `delete_google_health_entry` undoes any
  of the three by the `name` the write returned. Anonymous-food mode only (no Food catalog reference yet);
  exercise-session writes are out of scope.
- **Not deduplicated — by design of the API, not this server.** Live testing against the real API proved
  Google assigns its own id on every create (a client-supplied `name` is silently ignored) and never
  rejects a repeat: calling one of the log tools twice for the same entry creates two entries, with no
  error and no server-side idempotency to catch it. Callers must not retry blindly.

## [0.2.0] — 2026-09-02

### Added
- **Exercise sessions from Google Health, complete.** `list_exercise_sessions`, `get_exercise_session`,
  `sync_exercise_sessions`, `export_exercise_tcx` (GPS/lap TCX), `get_workout_day`. Sessions carry type,
  muscle-group name, active vs elapsed duration, calories, distance, steps, avg HR, HR-zone minutes, pause
  events, laps/splits, notes, GPS flag, source. Cached in `gh_exercise_sessions`; finished days are served
  from disk.
- **Sets/reps linked to the watch session.** `log_workout` / `update_workout` / `list_workouts` take
  `session_id`; sessions return `logged_sets`. Google Health records no exercise names, sets, reps or weights —
  this is where they live.
- **Full nutrition detail per logged food**: serving `{amount, unit}`, fiber, sugar, sodium, saturated fat,
  cholesterol, energy-from-fat, food reference, and a `nutrients` map of every nutrient Google recorded.
  `get_food_log` gains `group_by_meal` with per-meal totals; `get_nutrition_intake` gains saturated fat,
  cholesterol and `nutrients`.
- `query_google_health(data_type, from, to)` — raw escape hatch over all 42 Google Health v4 data types with
  the right filter grammar per type; write-only types are refused with a clear message.
- `get_heart` returns the day's personal HR-zone boundaries; `get_breathing` returns per-sleep-stage
  breathing rate and now takes `date`.
- **Local day cache for Google Health history** (`gh_daily`): `get_health_cache_status`,
  `backfill_google_health` (8 days/call), `node server/backfill-gh.cjs <from> <to>` for long ranges; every
  Google-Health read tool takes an optional `date` and serves past dates with zero API calls.
- `docs/google-health-api-v4.md` — the v4 method/type/filter reference and a feature roadmap.

### Changed
- **Breaking:** trace nutrients are reported in milligrams — `sodium_mg`, `cholesterol_mg` (were `sodium_g`;
  cholesterol at 0.005 g rounded to 0).
- The MCP server version now follows `package.json`.
- README: the claim that Google Health has no write API was wrong — v4 has `create`/`patch`/`batchDelete`
  under `*.writeonly` scopes; this server requests read-only scopes only.

### Fixed
- `pauses` counted Fitbit's terminal PAUSE marker on sessions that were never paused.
- Exercise refetch window missed sessions that synced to Google after their day was first cached.
- `get_workout_day` scoped attached sets to the day they were logged instead of the session they belong to.
- `query_google_health` output was unbounded; ECG queries ignored `to`; `sync_exercise_sessions` did not
  chunk long ranges; a session without a start time aborted the whole batch; TCX export now reports size.

## [0.1.0] — 2026-07-24

Initial public release: Google Health v4 read tools (activity, heart, sleep, hydration, body, glucose, SpO2,
breathing, temperature, ECG, devices), nutrition-log sync + cache, local workouts/meals/plans/habits/
reminders/hydration, bearer-token MCP over Streamable HTTP.
