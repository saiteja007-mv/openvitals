# Health MCP — project instructions

**Before starting any work, read [`session_handoff.md`](./session_handoff.md) for the current state and where to resume.** Update it at the end of a working session.

## Stack & commands
- React + Vite + TypeScript front end (`src/`); node:sqlite backend (`server/`). DB at `.data/health-mcp.sqlite`.
- Run: `npm run server` + `npm run dev`. Verify: `npx tsc --noEmit` and `node --test` (must stay green); `npx vite build` for a full check.

## Design
Strict-monochrome Uber/Base-Web system (black/white/greys, Inter, pill buttons, inset-hairline cards). No second accent color — carry meaning with weight, +/- signs, or ▲/▼ glyphs, not hue. Reuse the `src/components/UI.tsx` primitives (`Button`, `Card`, `Stat` incl. `delta`, `Empty` incl. `action`, `Field`, `Modal`, `Toast`) and `src/components/chart.tsx` tokens.

## Workflows & subagents (ALWAYS)
When work is spawned as a **Workflow** (or plain subagents), the session model (Opus/Fable) is the
**orchestrator only** — it scouts the code, writes the script/spec, reads results back, verifies, and
reports. It does not do the volume work.
- **Every `agent()` call passes `model: 'sonnet'`.** No exceptions (build, smoke, review, refute, fix,
  docs) unless the user names a different model for that run. Reason: usage limits — Opus/Fable tokens
  are for judgment, Sonnet 5 does the volume.
- **Strict, self-contained agent prompts.** An agent sees no conversation history, so each prompt must
  carry: the exact files to touch, the exact behaviour wanted, the *facts already established* (so it
  does not re-derive or re-litigate them), what it must NOT touch, and the verify command it must run
  (`npx tsc --noEmit`, `node --test`).
- **No agent invents API behaviour.** Anything about the Google Health API is either already written
  down in `docs/` + `session_handoff.md` or must be probed live — never guessed.
- Orchestrator verifies before reporting: re-run `npx tsc --noEmit` and `node --test` yourself; do not
  trust an agent's "tests pass".
