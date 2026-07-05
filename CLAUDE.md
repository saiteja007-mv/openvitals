# Consied — project instructions

**Before starting any work, read [`session_handoff.md`](./session_handoff.md) for the current state and where to resume.** Update it at the end of a working session.

## Stack & commands
- React + Vite + TypeScript front end (`src/`); node:sqlite backend (`server/`). DB at `.data/consied.sqlite`.
- Run: `npm run server` + `npm run dev`. Verify: `npx tsc --noEmit` and `node --test` (must stay green); `npx vite build` for a full check.

## Design
Strict-monochrome Uber/Base-Web system (black/white/greys, Inter, pill buttons, inset-hairline cards). No second accent color — carry meaning with weight, +/- signs, or ▲/▼ glyphs, not hue. Reuse the `src/components/UI.tsx` primitives (`Button`, `Card`, `Stat` incl. `delta`, `Empty` incl. `action`, `Field`, `Modal`, `Toast`) and `src/components/chart.tsx` tokens.
