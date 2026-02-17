# Working Memory — OAuth + Multi-Method Provider Connect

> **This file is a live scratchpad for agents working through the OAuth provider connect plan.**
> Update it after completing each task. Read it before starting any task.

---

## How to use this file

1. **Before starting work:** Read the "Current Task" and "Key Decisions" sections to understand where things left off.
2. **When starting a task:** Update "Current Task" with the task ID, title, and your initial plan.
3. **During a task:** Log findings, blockers, and decisions in "Current Task Notes."
4. **After completing a task:** Move the task to "Completed Tasks," clear "Current Task Notes," and update "Current Task" to the next one.
5. **If you discover something unexpected:** Add it to "Open Questions / Blockers" or "Key Decisions."
6. **When you discover owner-only decisions or manual checks:** Add/update an item in `USER_VERIFICATION.md` (and mark items resolved when done).

---

## Current Task

**Task:** **Owner verification — UV-1..UV-* (plan gate)**
**Status:** _Waiting on owner_
**Branch:** `oauth-provider-revamp`

### Plan
- Review `feature-plans/oauth-and-more-providers/USER_VERIFICATION.md` and resolve key decisions (storage layout, provider ID strategy, config surface).
- Once UV items are cleared (or explicitly deferred), start Phase 0 tasks in `PLAN.md`.

### Notes
_Log findings, issues, and progress here as you work._

2026-02-17:
- Imported the OAuth provider plan into this worktree and refactored it to the `PLAN.md` + `WORKING_MEMORY.md` + `USER_VERIFICATION.md` paradigm.
- Tasklist re-written with numbered tasks and explicit exit criteria.
- Read through OpenCode/OpenClaw reference implementations and updated `PLAN.md` with concrete file-path pointers for OAuth flows, storage shapes, and two-phase authorize/callback APIs.
- Pulled concrete models.dev provider metadata (provider IDs, base URLs, env vars, recommended SDKs) and updated `PLAN.md` to include an actionable diff for MiniMax / Z.AI / Zhipu / Moonshot / Kimi Code. Key finding: models.dev treats MiniMax + Kimi Code as **Anthropic-compatible**, while Dexto today assumes MiniMax is OpenAI-compatible.

---

## Key Decisions

_Record important decisions made during implementation that aren't in the main plan. Include date and reasoning._

| Date | Decision | Reasoning |
|------|----------|-----------|
| _TBD_ |  |  |

---

## Open Questions / Blockers

- See `feature-plans/oauth-and-more-providers/USER_VERIFICATION.md` for owner-only questions.

---

## Completed Tasks

_Move tasks here after completion. Keep a brief log of what was done and any deviations from the plan._

| Task | Title | Date | Notes |
|------|-------|------|-------|
| _TBD_ |  |  |  |

---

## Phase Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Decisions + interface design | Not started | — |
| Phase 1 — Scaffolding + API surface | Not started | — |
| Phase 2 — Provider presets + more providers | Not started | — |
| Phase 3 — OpenAI ChatGPT OAuth (Codex) | Not started | — |
| Phase 4 — MiniMax Portal OAuth | Not started | — |
| Phase 5 — Anthropic setup-token (if viable) | Not started | — |
| Phase 6 — Bedrock + Vertex connect UX | Not started | — |
| Phase 7 — WebUI parity | Not started | — |

---

## Checkpoint Log

_Record checkpoint validation results after each phase boundary._

| Phase boundary | Date | Result | Issues |
|----------------|------|--------|--------|
| _TBD_ |  |  |  |
