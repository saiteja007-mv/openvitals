# Consied UI Review — Implementation Handoff

> Resume point for the 68-finding UI enhancement pass. Full interactive triage doc (artifact):
> https://claude.ai/code/artifact/53d663cf-0b0d-4b91-a28b-f5d1dafd59d9

**Progress: Batches A–E committed on `ui-review-batches` — ~26 findings addressed / 68 total** (checklist checkboxes below; token-level fixes also silently close the touch-target + contrast items across every screen)

## How to resume
1. `cd ~/consied` — the app is React + Vite (frontend) + node:sqlite backend (`server/`).
2. After edits: `npx tsc --noEmit` (frontend typecheck) and `node --test` (backend, 66 tests). Both must stay green.
3. Run locally: `npm run server` (backend :PORT) + `npm run dev` (Vite). DB at `.data/consied.sqlite`.
4. Pick the next unchecked `[ ]` item below (they are ordered High→Low within each screen). Work screen-by-screen; keep diffs small; re-run tsc+tests after each screen; update this file's checkboxes + progress count.

## Already shipped this session (uncommitted, not yet in git)
- **Streak = log-to-count**: `server/db.cjs` habitStreak drops the auto-grace; `src/screens/Today.tsx` optimistic update; `test/db.test.cjs` updated. (66 tests pass.)
- **Log button**: habit checkbox → `Log` / `✓ Logged` pill in `src/screens/Today.tsx`.
- **Batch A — design system** (below, marked ✅): `src/theme.css` (stat-unit contrast, .stat-delta, .empty-action, @media(pointer:coarse) 44px targets), `src/components/UI.tsx` (Button spinner variant-aware, Empty `action` slot, Stat `delta` slot), `src/screens/Today.tsx` (monochrome calorie balance + no-meals guard).

- **Batch B — app shell / nav** (`src/App.tsx`, `src/theme.css`): emoji nav icons → inline monochrome SVGs (`ICONS`/`NavIcon`, currentColor); bottom-nav active indicator (2px ink top-bar + bold); brand wordmark now links to Today; app-wide `:focus-visible` ink ring for all nav/buttons/chips/cards.
- **Batch C — destructive-action guards** (`Food.tsx`, `Workouts.tsx`, `Settings.tsx`): `confirm()` root-caused in each shared `del`/`restore` — meal, template, workout, plan, reminder deletes + the **Restore-backup wipe** (the data-loss trap) now all require confirmation.
- **Batch D — Today polish** (`src/screens/Today.tsx`): empty Workouts/Meals slabs now carry a "Log a workout/meal" CTA via the new `Empty action` slot (routes to /workouts, /food); raw ISO dates → friendly `fmtDay()` ("Jul 4").
- **Batch E — Exercises** (`src/screens/Exercises.tsx`, `src/theme.css`): skeleton cards on first load + grid dims on re-filter (no more full-grid spinner flash); cards keyboard-accessible (`role/tabIndex/onKeyDown`); honest "Load more · showing N of total"; quiet monochrome dumbbell placeholder (no "no preview" text); modal "No instructions available." fallback; inline search-clear ✕.

> NOTE: `Empty` now takes an `action?` prop and `Stat` takes a `delta?` prop — the primitives are ready; wiring CTAs / deltas into each screen is part of the pending per-screen items. The `.excard:focus-visible` ring is in place but Exercises cards still need `role="button" tabIndex={0}` + keydown to actually receive focus (see Exercises pending).

## Pending work — prioritized checklist
Grouped by screen, High→Low. `Impact/Effort` `category`.

### Today
- [x] `H/S` `consistency` **Calorie balance uses green/red — the only color on a strict-monochrome screen** — ✅ Batch A
- [x] `H/S` `information-design` **A big green "-1,495 deficit" is shown when zero meals are logged** — ✅ Batch A
- [ ] `H/M` `interaction` **Every date change blanks the whole screen to a tiny centered spinner**
  - fix: Keep the header and the day-nav row mounted; gate only the data region below it. Either move `<Loading/>` into the content area, or render skeleton stat cards (reuse `.stat` chrome with a `--canvas-soft` fill) while `loading`. The day title
  - loc: `src/screens/Today.tsx:136,72-85`
- [x] `M/S` `empty-state` **Empty Workouts and Meals sections are dead-end slabs with no way to act** — ✅ Batch D (Empty `action` CTAs → /workouts, /food)
- [ ] `M/M` `information-design` **12 identical stat cards with no hierarchy, and bare "—" gives no reason a value is missing**
  - fix: For metrics that have a goal in Settings, add a `.caption` delta under the value (e.g. '1,127 to goal' / '92% of goal') reusing the numbers the Goals card already computes — this both creates hierarchy and links the two sections. For '—', u
  - loc: `src/screens/Today.tsx:209-222; src/components/UI.tsx:23-30`
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
- [ ] `H/S` `information-design` **Cryptic 'P30 C40 F12' macro shorthand, inconsistent with the summary card**
  - fix: Standardize on one legible pattern reusing the summary card's middot style: '30g P · 40g C · 12g F' (or 'P 30 · C 40 · F 12'). Apply at Food.tsx:117/223/467/487 so list rows match the summary. Pure text change, no new tokens.
  - loc: `Food.tsx:117`
- [x] `M/S` `accessibility` **The 'kcal' unit on the hero number is near-invisible** — ✅ Batch A
- [ ] `M/S` `consistency` **Lookup tab fires three competing black primary pills**
  - fix: Keep one primary per section: make 'Search foods' variant="secondary" (it pairs with its input just like the barcode 'Look up' does) or make barcode 'Look up' secondary, so barcode-lookup and name-search read as two peer secondary tools and
  - loc: `Food.tsx:449`
- [ ] `M/M` `visual` **Emoji icons break the strict-monochrome rule**
  - fix: Swap the emoji for inline monochrome SVG glyphs filled with currentColor (pencil/trash/×), so they inherit --ink and stay on-system. Keeps the good existing aria-labels; only the glyph source changes. Do it once in the iconbtn call sites.
  - loc: `Food.tsx:121`
- [ ] `M/M` `interaction` **Template 'Log as' row is verbose and ambiguous while logging**
  - fix: Track the in-flight type (e.g. logging = {id, type}) so only the tapped chip shows '…' and the rest merely disable. Better, collapse the four chips into one primary 'Log now' defaulting to guessMealType() plus a compact type Select — mirror
  - loc: `Food.tsx:231`
- [ ] `M/M` `information-design` **Total-intake macros are a cramped, non-comparable caption**
  - fix: Reuse the existing Stat component and .grid-stats (already 4-up at ≥720px, theme.css:57-58) to show Cals / P / C / F as four labeled, comparable stats, keeping kcal visually dominant. Or add a thin grayscale stacked proportion bar (canvas-s
  - loc: `Food.tsx:101`

### Trends
- [ ] `H/S` `empty-state` **No-data state is a wall of 8 identical empties behind a dead pager**
  - fix: Guard the Charts tab: if maxDate is falsy (no series and no calAll rows), skip both the pager (lines 120-125) and the 8 ChartCards and render ONE page-level <Empty> with actionable copy, e.g. 'No health data synced yet. Connect Google Healt
  - loc: `src/screens/Trends.tsx:118-138`
- [ ] `H/M` `information-design` **Charts show shapes but zero comparable numbers**
  - fix: In the ChartCard header row, add a right-aligned .caption computed from the windowed series: latest value + unit and delta vs the previous equal window (compare win() at current page vs page+1), e.g. '72 bpm · ▲2 vs prev 30d'. Color the del
  - loc: `src/screens/Trends.tsx:212-214`
- [ ] `M/S` `visual` **Default Recharts Tooltip breaks the monochrome Base-Web language**
  - fix: Define one shared tooltip config and pass it to all three: contentStyle={{ fontFamily: var(--font), fontSize:12, border:'1px solid var(--hairline)', borderRadius:8 }}, itemStyle color var(--ink), a formatter that appends the metric unit ('7
  - loc: `src/screens/Trends.tsx:130`
- [ ] `M/S` `accessibility` **Calories in-vs-out relies on faint grey-vs-black color alone**
  - fix: Keep both lines dark and distinguish by pattern instead of lightness: give 'In' strokeDasharray="4 3" (and/or use --hairline-mid #4b4b4b rather than #afafaf). Pattern + weight reads clearly in strict monochrome without introducing color.
  - loc: `src/screens/Trends.tsx:130`
- [ ] `M/S` `microcopy` **Per-metric 'No data for this range' misleads for never-logged metrics**
  - fix: Pass the full (unwindowed) series into NoData. If the metric has zero points overall, render a metric-level 'No {metric} logged yet' (or drop the card entirely); only when points exist outside the current window show 'No data in this range.
  - loc: `src/screens/Trends.tsx:215`
- [x] `M/S` `accessibility` **Range chips and pager arrows are sub-44px touch targets** — ✅ Batch A
- [ ] `L/S` `consistency` **Chart colors hardcoded instead of theme tokens**
  - fix: Hoist a single CHART palette constant at the top of the file mapping to the token values (or read them once via getComputedStyle(document.documentElement)) and reference it in bar/line/calories/AX. One source of truth, consistent with the t
  - loc: `src/screens/Trends.tsx:203-210`

### Workouts
- [ ] `H/M` `information-design` **Progress tab dumps the app's most important numbers into a run-on caption**
  - fix: Restructure each ProgressEntry card into scannable figures using tokens that already exist: promote Max weight and Last-session volume to `.stat-value` / `.stat-label` pairs (or two `Stat` components) laid out in a `.row`, instead of one ca
  - loc: `Workouts.tsx:295-309`
- [ ] `H/M` `information-design` **Plan logging shows target vs actual but no hit/miss signal**
  - fix: Give the row a done-state that reuses existing chrome: when `logged.length > 0`, add a monochrome check glyph (✓) next to the item name and/or bold the name (`fontWeight:600`), matching how the PR `.tag` at Workouts.tsx:299 signals status. 
  - loc: `Workouts.tsx:217-234`
- [ ] `M/S` `empty-state` **Plans tab has no empty state (blank area for first-time users)**
  - fix: Mirror the sibling tabs: `plans.length === 0 ? <div style={{marginTop:16}}><Empty>No plans yet. Create a Push / Pull / Legs routine or your own with New plan.</Empty></div>` inside the non-loading branch. Reuses the existing `Empty` compone
  - loc: `Workouts.tsx:146-156`
- [ ] `M/S` `interaction` **Plan cards are expandable but give no affordance that they open**
  - fix: Add a monochrome chevron on the right of the header (▸ collapsed, ▾ open) before the edit/delete buttons, using the same `.caption`/ink color. This is the standard Base Web disclosure cue and matches the FAQ-row accordion pattern in DESIGN.
  - loc: `Workouts.tsx:174-184`
- [ ] `M/S` `responsive` **Log table can overflow horizontally on narrow phones**
  - fix: Wrap the `<table>` in a `<div style={{overflowX:'auto'}}>` so overflow scrolls inside the card instead of the page, or on mobile drop Detail onto a second line beneath the Exercise name. The same pattern is reused in Food.tsx, so fixing it 
  - loc: `Workouts.tsx:49-68`
- [x] `M/M` `interaction` **Destructive delete fires instantly with no confirm or undo** — ✅ Batch C (confirm() on workout + plan del)
- [ ] `L/S` `consistency` **Plan "Kind" is a free-text input, producing inconsistent tags**
  - fix: Swap the Kind `Input` for the existing `<Select>` with fixed options (push / pull / legs / custom). Native constraint, no new dependency, guarantees clean `.tag` values, and matches the app's own component kit.
  - loc: `Workouts.tsx:265`

### Settings
- [ ] `H/S` `interaction` **Reminder On/Off toggle has no visible active state**
  - fix: Set `className={`chip ${r.enabled ? 'active' : ''}`}` so the on-state flips to the black pill per the brand's active-chip pattern, and add `aria-pressed={!!r.enabled}` to expose the toggle state. Zero new CSS — it reuses the existing token.
  - loc: `src/screens/Settings.tsx:140`
- [ ] `H/M` `consistency` **Raw native file input breaks the monochrome pill language**
  - fix: Hide the input (`display:none`) and trigger it from a styled control that matches the sibling export buttons — e.g. a `<label>` wrapping a `Button variant="secondary"` ("Choose backup file…"), or style `::file-selector-button` to the `.btn-
  - loc: `src/screens/Settings.tsx:209`
- [x] `H/M` `interaction` **Destructive Restore and Delete fire instantly with no confirmation** — ✅ Batch C (confirm() on restore-wipe + reminder del)
  - superseded fix (done):
  - loc: `src/screens/Settings.tsx:211`
- [ ] `M/S` `empty-state` **No empty state when there are zero reminders**
  - fix: When `reminders.length === 0`, render `<Empty>No reminders yet — add one below to get a nudge on Slack or Telegram.</Empty>` above the add card. Reuses the existing Empty component and canvas-soft empty-state token; one conditional line.
  - loc: `src/screens/Settings.tsx:130`
- [ ] `M/S` `responsive` **Two-up form fields never stack on narrow phones**
  - fix: Swap the field-pair `.row` wrappers to `.row-wrap` so the two fields drop to a single column below the flex min-width. It's a class rename that reuses an existing token; the desktop two-up layout is unchanged.
  - loc: `src/screens/Settings.tsx:81`
- [ ] `M/S` `microcopy` **Developer jargon leaks into user-facing microcopy**
  - fix: Relabel the Telegram field 'Bot token & chat ID' with the `botToken:chatId` format demoted to the input placeholder, and change the row hint to a plain 'Local only — no delivery channel set.' Text-only change.
  - loc: `src/screens/Settings.tsx:137`
- [ ] `L/S` `information-design` **Recommendation flags use hardcoded red with no hierarchy**
  - fix: Replace the inline hex with the existing class: `className="caption net-neg"`, and give flags a leading marker or a hairline-separated block so they visually outrank the disclaimer. Reuses the `.net-neg` token; removes a hardcoded color.
  - loc: `src/screens/Settings.tsx:34`

### Login
- [ ] `H/S` `microcopy` **"Incorrect password" is shown for every failure, including server/network errors**
  - fix: Catch the error and prefer its message: `catch (err) { setError(err instanceof Error && err.message && err.message !== 'login failed' ? err.message : 'Incorrect password') }`. Keep the generic auth wording only as the fallback so a real 401
  - loc: `src/screens/Login.tsx:18-19`
- [ ] `M/S` `accessibility` **Login error is invisible to screen readers and unlinked to the input**
  - fix: Add `role="alert"` to the error div (line 52) so it's announced on appearance, give it an id, and on the Input set `aria-invalid={!!error}` plus `aria-describedby` pointing at that id when error is set. All within the existing `.caption` st
  - loc: `src/screens/Login.tsx:52`
- [ ] `M/S` `interaction` **Stale "Incorrect password" stays on screen while the user retypes**
  - fix: Clear the error as soon as the value changes: in the onChange (line 37) also call `if (error) setError('')`. Cheap, and it keeps the aria-invalid state from lingering on the input too.
  - loc: `src/screens/Login.tsx:37`
- [ ] `M/S` `visual` **Login card is white-on-white with only a hairline — it barely reads as a surface**
  - fix: Lift the card with the existing shadow token instead of adding a new one: pass `className="elevated"` (theme.css:124, `--shadow-1`) to the `<Card>` at Login.tsx:28. Since `.elevated` replaces the inset hairline, combine them so both survive
  - loc: `src/screens/Login.tsx:28`
- [ ] `M/S` `empty-state` **Wordmark is app-bar-sized and the screen has no supporting copy — the front door feels like an empty state**
  - fix: Give the login its own hero scale: bump the wordmark on this screen to a display size (32px/700, matching h1/`display-lg` in DESIGN.md) and add a muted subhead beneath it using the existing `.caption`/`.muted` class, e.g. "Sign in to contin
  - loc: `src/screens/Login.tsx:29`
- [x] `M/S` `accessibility` **Show/Hide password toggle is below the 44px minimum tap target on mobile** — ✅ Batch A
- [ ] `L/S` `consistency` **Error uses a raw hex and 12px caption size instead of a system token**
  - fix: Reuse the existing class rather than the raw hex: render the error as `<div className="caption net-neg" role="alert">` (dropping the inline `style`), or add a `--error: #b00020` token and point `.net-neg`/`.btn-danger` at it so there's one 
  - loc: `src/screens/Login.tsx:52`

### App shell + navigation
- [x] `H/M` `visual` **Colored emoji nav icons break the strict-monochrome system** — ✅ Batch B (monochrome SVG icons, currentColor)
- [x] `M/S` `consistency` **Bottom-nav active state is far weaker than the top-nav pill** — ✅ Batch B (2px ink top-bar + bold on `.bnitem.active`)
- [ ] `M/M` `responsive` **Six equal-width tabs overcrowd the mobile bottom bar**
  - fix: Cap the mobile bottom bar at 5 primary tabs and demote the overflow (e.g. Trends) — either fold it under a 'More' tab or surface it in the appbar next to the ⚙ gear, which is already the mobile home for secondary destinations. Keeps each ta
  - loc: `src/App.tsx:61-68`
- [x] `M/S` `accessibility` **Nav links have no keyboard-focus indication** — ✅ Batch B (app-wide `:focus-visible` ink ring)
- [x] `L/S` `interaction` **Brand wordmark is not a link to Today** — ✅ Batch B (`NavLink to="/"`)
- [ ] `L/S` `empty-state` **Whole-app boot state is a tiny top-anchored spinner**
  - fix: Give the boot state real vertical presence: add min-height:100vh and align-items:center to .center-load (or a boot-specific variant). Optionally show the 'Consied.' wordmark above the spinner so the first paint is branded rather than empty.
  - loc: `src/App.tsx:32`
