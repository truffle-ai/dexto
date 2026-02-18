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

**Task:** **Owner review — Updated direction + tasklist rebase**
**Status:** _Waiting on owner_
**Branch:** `oauth-provider-revamp`

### Plan
- Review the direction update in `feature-plans/oauth-and-more-providers/UPDATED_DIRECTION.md`.
- Confirm the rebaselined tasklist in `feature-plans/oauth-and-more-providers/PLAN.md` (new Phase 1.5 for gateway catalogs; fix `/connect` multi-profile overwrite).
- Once aligned, proceed with **1.3.1** (multi-profile UX) and then Phase 1.5 gateway ingestion (**1.5.2** OpenRouter, **1.5.3** Vercel AI Gateway) in that order.

### Notes
_Log findings, issues, and progress here as you work._

2026-02-18:
- Verified OpenCode has **no release-date (“last 6 months”) catalog filter**; the picker is Favorites + Recent (last used) and hides deprecated models.
- Verified OpenCode’s OpenRouter model list is **limited by models.dev curation** (not OpenRouter’s live `/models`).
- Added `UPDATED_DIRECTION.md` and updated `PLAN.md` to adopt a pi-style multi-source model registry direction (models.dev baseline + gateway catalogs, starting with OpenRouter).
- Phase 1 scaffolding exists in-repo (profiles store + runtime resolver + server routes + CLI `/connect`), but `/connect` still overwrites profiles because `profileId` is fixed to `${providerId}:${methodId}`.

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
| 1.1 | LLM profile store (`llm-profiles.json`) | 2026-02-18 | Implemented file-backed multi-profile store + defaults + tests. |
| 1.2 | Server routes for connect providers/profiles/defaults | 2026-02-18 | Added `packages/server/src/hono/routes/llm-connect.ts` (redacted profiles). |
| 1.3 | CLI interactive `/connect` | 2026-02-18 | Added `/connect` flow + initial OAuth method scaffolding; still needs multi-profile IDs. |
| — | Direction + tasklist rebase | 2026-02-18 | Added `UPDATED_DIRECTION.md`; updated tasklist to include gateway catalog ingestion. |

---

## Phase Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Decisions + interface design | Partial | Several decisions are implemented but still tracked in `USER_VERIFICATION.md` for owner confirmation. |
| Phase 1 — Scaffolding + API surface | Completed | Profiles store + runtime resolver + server routes + CLI `/connect` landed. |
| Phase 1.5 — Model/provider registry sources | Not started | Add OpenRouter live catalog ingestion + provider snapshot generation. |
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
