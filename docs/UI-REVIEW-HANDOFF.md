# Health MCP UI Review — Implementation Handoff

> Resume point for the 68-finding UI enhancement pass. Full interactive triage doc (artifact):
> https://claude.ai/code/artifact/53d663cf-0b0d-4b91-a28b-f5d1dafd59d9

**Progress: COMPLETE — Batches A–K committed on `ui-review-batches`, 68 / 68 addressed** (tsc + build + 66 tests green). A few finding *sub-notes* were consciously deferred as lower-value (see below); every finding itself is addressed.

### Consciously deferred sub-notes (optional future polish)
- **Trends** — prev-window Δ (currently shows `latest · avg`, not "vs prev 30d").
- **Body** — inline *edit* of history entries (delete is done).
- **Exercises** — full modal focus-*trap* (focus-on-open + Escape + restore are done; Tab can still leave the dialog).

## How to resume
1. `cd ~/health-mcp` — the app is React + Vite (frontend) + node:sqlite backend (`server/`).
2. After edits: `npx tsc --noEmit` (frontend typecheck) and `node --test` (backend, 66 tests). Both must stay green.
3. Run locally: `npm run server` (backend :PORT) + `npm run dev` (Vite). DB at `.data/health-mcp.sqlite`.
4. Pick the next unchecked `[ ]` item below (they are ordered High→Low within each screen). Work screen-by-screen; keep diffs small; re-run tsc+tests after each screen; update this file's checkboxes + progress count.

## Already shipped this session (Batches A–K committed on `ui-review-batches`)
- **Streak = log-to-count**: `server/db.cjs` habitStreak drops the auto-grace; `src/screens/Today.tsx` optimistic update; `test/db.test.cjs` updated. (66 tests pass.)
- **Log button**: habit checkbox → `Log` / `✓ Logged` pill in `src/screens/Today.tsx`.
- **Batch A — design system** (below, marked ✅): `src/theme.css` (stat-unit contrast, .stat-delta, .empty-action, @media(pointer:coarse) 44px targets), `src/components/UI.tsx` (Button spinner variant-aware, Empty `action` slot, Stat `delta` slot), `src/screens/Today.tsx` (monochrome calorie balance + no-meals guard).

- **Batch B — app shell / nav** (`src/App.tsx`, `src/theme.css`): emoji nav icons → inline monochrome SVGs (`ICONS`/`NavIcon`, currentColor); bottom-nav active indicator (2px ink top-bar + bold); brand wordmark now links to Today; app-wide `:focus-visible` ink ring for all nav/buttons/chips/cards.
- **Batch C — destructive-action guards** (`Food.tsx`, `Workouts.tsx`, `Settings.tsx`): `confirm()` root-caused in each shared `del`/`restore` — meal, template, workout, plan, reminder deletes + the **Restore-backup wipe** (the data-loss trap) now all require confirmation.
- **Batch D — Today polish** (`src/screens/Today.tsx`): empty Workouts/Meals slabs now carry a "Log a workout/meal" CTA via the new `Empty action` slot (routes to /workouts, /food); raw ISO dates → friendly `fmtDay()` ("Jul 4").
- **Batch E — Exercises** (`src/screens/Exercises.tsx`, `src/theme.css`): skeleton cards on first load + grid dims on re-filter (no more full-grid spinner flash); cards keyboard-accessible (`role/tabIndex/onKeyDown`); honest "Load more · showing N of total"; quiet monochrome dumbbell placeholder (no "no preview" text); modal "No instructions available." fallback; inline search-clear ✕.
- **Batch F — Trends + Body charts** (`src/components/chart.tsx` NEW, `Trends.tsx`, `Body.tsx`): shared monochrome `CHART`/`AXIS`/`TOOLTIP` (styled Recharts tooltip, one palette source); Trends page-level no-sync Empty guard, `latest · avg` summary per card, dashed "In" line. Body first-run onboarding, `Stat delta` ▲/▼ vs-last, notes shown, `.row-wrap`, save-guard, delete-with-confirm. Deferred: Trends prev-window Δ + per-metric never-logged copy; Body inline edit.
- **Batches G/H/I — Settings / Food / Workouts** (parallel workflow, 3 disjoint files): **G Settings** — reminder On/Off active pill, styled "Choose backup file…" button, reminders empty state, mobile field-wrap, friendlier microcopy, net-neg token for flags. **H Food** — legible "30g P · 40g C · 12g F" macros everywhere, trash/pencil emoji → monochrome SVG, single primary in Lookup, isolated "Log as" chip, Total-intake kcal hero + macro Stat tiles. **I Workouts** — Progress as Stat tiles (Max weight ▲/▼ vs last month + Last volume), ✓ on logged plan items, Plans empty state, ▸/▾ disclosure chevron, Kind → Select, log table scrolls in-card.
- **Batch J — Login + Modal/Toast a11y** (`Login.tsx`, `components/UI.tsx`): Login surfaces the real error (not always "Incorrect password"), announces it via `role="alert"` + `aria-invalid`/`aria-describedby`, clears it on retype, lifts the card (`elevated`), gives the wordmark a hero scale + "Sign in to continue." subhead, and uses the `net-neg` token. Modal → `role="dialog" aria-modal aria-labelledby`, Escape-to-close, focus-on-open (won't steal an autoFocus field) + restore-on-close. Toast → `role="status" aria-live="polite"`.
- **Batch K — final polish** (`Today.tsx`, `Trends.tsx`, `App.tsx`, `theme.css`, `Body.tsx`): Today only blocks on first load (date changes keep the page mounted, no collapse) + goal-progress deltas on Steps/Sleep; mobile bottom bar capped at 5 tabs (Trends → app-bar icon via `.only-mobile`); branded full-height boot screen; Body progress photo uses a styled "Add photo" button over a hidden input; Trends charts say "No data logged yet" vs "No data for this range".

> NOTE: `Empty` now takes an `action?` prop and `Stat` takes a `delta?` prop — the primitives are ready; wiring CTAs / deltas into each screen is part of the pending per-screen items. The `.excard:focus-visible` ring is in place but Exercises cards still need `role="button" tabIndex={0}` + keydown to actually receive focus (see Exercises pending).

## Pending work — prioritized checklist
Grouped by screen, High→Low. `Impact/Effort` `category`.

### Today
- [x] `H/S` `consistency` **Calorie balance uses green/red — the only color on a strict-monochrome screen** — ✅ Batch A
- [x] `H/S` `information-design` **A big green "-1,495 deficit" is shown when zero meals are logged** — ✅ Batch A
- [x] `H/M` `interaction` **Every date change blanks the whole screen to a tiny centered spinner** — ✅ Batch K
- [x] `M/S` `empty-state` **Empty Workouts and Meals sections are dead-end slabs with no way to act** — ✅ Batch D (Empty `action` CTAs → /workouts, /food)
- [x] `M/M` `information-design` **12 identical stat cards with no hierarchy, and bare "—" gives no reason a value is missing** — ✅ Batch K
- [x] `M/S` `accessibility` **Day-nav arrows are 36px — below the 44px touch target the brand itself specifies** — ✅ Batch A
- [x] `L/S` `microcopy` **Raw ISO dates ('2026-06-30') break the friendly, sentence-case brand voice** — ✅ Batch D (`fmtDay()` → "Jul 4")

### Exercises
- [x] `H/M` `interaction` **Every keystroke/filter change flashes the whole grid to a centered spinner** — ✅ Batch E (skeleton cards on first load; grid dims on re-filter)
- [x] `H/S` `accessibility` **Exercise cards are non-semantic clickable divs — unreachable by keyboard** — ✅ Batch E (role/tabIndex/onKeyDown + focus ring)
- [x] `H/M` `information-design` **48 of 1,324 shown with no 'load more' and a misleading count** — ✅ Batch E (Load more + "showing N of total")
- [x] `M/S` `visual` **'no preview' placeholder dominates the grid and uses the wrong font** — ✅ Batch E (quiet dumbbell mark, no text)
- [x] `M/S` `empty-state` **Detail modal renders a blank body when an exercise has no instructions** — ✅ Batch E ("No instructions available.")
- [x] `M/S` `interaction` **Search field has no clear affordance** — ✅ Batch E (inline clear ✕; filter reset to 48 on change)

### Meals (Food)
- [x] `H/M` `interaction` **Delete is instant, unconfirmed, and one mis-tap away from Edit** — ✅ Batch C (confirm() on meal + template del; 44px targets from Batch A)
- [x] `H/S` `information-design` **Cryptic 'P30 C40 F12' macro shorthand, inconsistent with the summary card** — ✅ Batch H
- [x] `M/S` `accessibility` **The 'kcal' unit on the hero number is near-invisible** — ✅ Batch A
- [x] `M/S` `consistency` **Lookup tab fires three competing black primary pills** — ✅ Batch H
- [x] `M/M` `visual` **Emoji icons break the strict-monochrome rule** — ✅ Batch H
- [x] `M/M` `interaction` **Template 'Log as' row is verbose and ambiguous while logging** — ✅ Batch H
- [x] `M/M` `information-design` **Total-intake macros are a cramped, non-comparable caption** — ✅ Batch H

### Trends
- [x] `H/S` `empty-state` **No-data state is a wall of 8 identical empties behind a dead pager** — ✅ Batch F (page-level Empty guard when `!maxDate`)
- [x] `H/M` `information-design` **Charts show shapes but zero comparable numbers** — ✅ Batch F (ChartCard header shows `latest · avg`; prev-window Δ still TODO)
- [x] `M/S` `visual` **Default Recharts Tooltip breaks the monochrome Base-Web language** — ✅ Batch F (shared `TOOLTIP` in `components/chart.tsx`)
- [x] `M/S` `accessibility` **Calories in-vs-out relies on faint grey-vs-black color alone** — ✅ Batch F ("In" line dashed + `CHART.mid`)
- [x] `M/S` `microcopy` **Per-metric 'No data for this range' misleads for never-logged metrics** — ✅ Batch K
- [x] `M/S` `accessibility` **Range chips and pager arrows are sub-44px touch targets** — ✅ Batch A
- [x] `L/S` `consistency` **Chart colors hardcoded instead of theme tokens** — ✅ Batch F (`CHART`/`AXIS` in `components/chart.tsx`)

### Workouts
- [x] `H/M` `information-design` **Progress tab dumps the app's most important numbers into a run-on caption** — ✅ Batch I
- [x] `H/M` `information-design` **Plan logging shows target vs actual but no hit/miss signal** — ✅ Batch I
- [x] `M/S` `empty-state` **Plans tab has no empty state (blank area for first-time users)** — ✅ Batch I
- [x] `M/S` `interaction` **Plan cards are expandable but give no affordance that they open** — ✅ Batch I
- [x] `M/S` `responsive` **Log table can overflow horizontally on narrow phones** — ✅ Batch I
- [x] `M/M` `interaction` **Destructive delete fires instantly with no confirm or undo** — ✅ Batch C (confirm() on workout + plan del)
- [x] `L/S` `consistency` **Plan "Kind" is a free-text input, producing inconsistent tags** — ✅ Batch I

### Settings
- [x] `H/S` `interaction` **Reminder On/Off toggle has no visible active state** — ✅ Batch G
- [x] `H/M` `consistency` **Raw native file input breaks the monochrome pill language** — ✅ Batch G
- [x] `H/M` `interaction` **Destructive Restore and Delete fire instantly with no confirmation** — ✅ Batch C (confirm() on restore-wipe + reminder del)
  - superseded fix (done):
  - loc: `src/screens/Settings.tsx:211`
- [x] `M/S` `empty-state` **No empty state when there are zero reminders** — ✅ Batch G
- [x] `M/S` `responsive` **Two-up form fields never stack on narrow phones** — ✅ Batch G
- [x] `M/S` `microcopy` **Developer jargon leaks into user-facing microcopy** — ✅ Batch G
- [x] `L/S` `information-design` **Recommendation flags use hardcoded red with no hierarchy** — ✅ Batch G

### Login
- [x] `H/S` `microcopy` **"Incorrect password" is shown for every failure, including server/network errors** — ✅ Batch J
- [x] `M/S` `accessibility` **Login error is invisible to screen readers and unlinked to the input** — ✅ Batch J
- [x] `M/S` `interaction` **Stale "Incorrect password" stays on screen while the user retypes** — ✅ Batch J
- [x] `M/S` `visual` **Login card is white-on-white with only a hairline — it barely reads as a surface** — ✅ Batch J
- [x] `M/S` `empty-state` **Wordmark is app-bar-sized and the screen has no supporting copy — the front door feels like an empty state** — ✅ Batch J
- [x] `M/S` `accessibility` **Show/Hide password toggle is below the 44px minimum tap target on mobile** — ✅ Batch A
- [x] `L/S` `consistency` **Error uses a raw hex and 12px caption size instead of a system token** — ✅ Batch J

### App shell + navigation
- [x] `H/M` `visual` **Colored emoji nav icons break the strict-monochrome system** — ✅ Batch B (monochrome SVG icons, currentColor)
- [x] `M/S` `consistency` **Bottom-nav active state is far weaker than the top-nav pill** — ✅ Batch B (2px ink top-bar + bold on `.bnitem.active`)
- [x] `M/M` `responsive` **Six equal-width tabs overcrowd the mobile bottom bar** — ✅ Batch K
- [x] `M/S` `accessibility` **Nav links have no keyboard-focus indication** — ✅ Batch B (app-wide `:focus-visible` ink ring)
- [x] `L/S` `interaction` **Brand wordmark is not a link to Today** — ✅ Batch B (`NavLink to="/"`)
- [x] `L/S` `empty-state` **Whole-app boot state is a tiny top-anchored spinner** — ✅ Batch K

### Body metrics
- [x] `H/M` `consistency` **History entries are read-only — no edit or delete** — ✅ Batch F (delete w/ confirm; inline edit still TODO)
- [x] `H/M` `empty-state` **First-run screen is a wall of em-dashes** — ✅ Batch F (onboarding Empty when no entries)
- [x] `H/M` `information-design` **Stats show only the latest value with no change/delta** — ✅ Batch F (`deltaOf` → Stat `delta` ▲/▼ "vs last")
- [x] `M/S` `information-design` **Chart tooltip is unstyled default recharts** — ✅ Batch F (shared `TOOLTIP` + `formatter` → "72.4 kg")
- [x] `M/S` `information-design` **Notes are captured and saved but never shown** — ✅ Batch F (rendered under history summary)
- [x] `M/S` `responsive` **Three number inputs in a non-wrapping row cram on mobile** — ✅ Batch F (`.row` → `.row-wrap`)
- [x] `M/S` `interaction` **Save is enabled on an empty form** — ✅ Batch F (disabled until a value/photo present)
- [x] `M/S` `visual` **Raw browser file input breaks the monochrome look** — ✅ Batch K

### Design system (tokens + UI kit)
- [x] `H/S` `empty-state` **Empty state has no action slot** — ✅ Batch A (`Empty action` prop; wired on Today in D)
- [x] `M/S` `consistency` **Button loading spinner white-on-light — invisible on non-primary** — ✅ Batch A (variant-aware `spin-dark`)
- [x] `M/S` `accessibility` **Stat unit rendered in --mute (low contrast)** — ✅ Batch A (`--mute` → `--body`)
- [x] `H/M` `information-design` **Stat can't show a delta/trend** — ✅ Batch A (`Stat delta` slot; used in Today/Body/Trends)
- [x] `M/S` `accessibility` **Icon buttons and small pills are 36px (sub-44px)** — ✅ Batch A (`@media(pointer:coarse)` 44px)
- [x] `H/M` `accessibility` **Modal and Toast lack dialog/live-region semantics** — TODO — ✅ Batch J
