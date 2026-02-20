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

Repo context:
- Worktree: `~/Projects/dexto-worktrees/oauth-provider-revamp` (branch: `oauth-provider-revamp`).
- `feature-plans/` is gitignored for untracked files. Stage commits with `git add -f feature-plans/...`.

---

## Current Task

**Task:** **1.5.1 Generate provider snapshot + make `LLMProvider` generated**
**Status:** _Not started_
**Branch:** `oauth-provider-revamp`

### Plan
- Implement Phase **1.5.1** provider snapshot generation and use it to generate `LLM_PROVIDERS` / `LLMProvider` (models.dev canonical IDs + small Dexto-only overlay).
- When expanding provider IDs to models.dev, ensure **reasoning presets** remain correct by keying reasoning/provider-options on the same transport mapping (`provider.npm` → transport kind), not on a small hardcoded provider enum.
- After 1.5.1, proceed with gateway ingestion (**1.5.2** OpenRouter, **1.5.3** Vercel AI Gateway).

### Notes
_Log findings, issues, and progress here as you work._

2026-02-18:
- Verified OpenCode has **no release-date (“last 6 months”) catalog filter**; the picker is Favorites + Recent (last used) and hides deprecated models.
- Verified OpenCode’s OpenRouter model list is **limited by models.dev curation** (not OpenRouter’s live `/models`).
- Added `UPDATED_DIRECTION.md` and updated `PLAN.md` to adopt a pi-style multi-source model registry direction (models.dev baseline + gateway catalogs, starting with OpenRouter).
- Phase 1 scaffolding exists in-repo (profiles store + runtime resolver + server routes + CLI `/connect`), but `/connect` still overwrites profiles because `profileId` is fixed to `${providerId}:${methodId}`.
  - Keep deterministic IDs, but add UX to avoid silent overwrites (explicit replace confirmation + “switch default to existing slot”).

2026-02-20:
- Completed **1.3.1**: `/connect` now prompts when an auth slot already exists, supports “use existing” (set default without re-auth), explicit replace, and delete (clears defaults).

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
| 1.3 | CLI interactive `/connect` | 2026-02-18 | Added `/connect` flow + initial OAuth method scaffolding. |
| 1.3.1 | Multi-profile UX (no overwrite) | 2026-02-20 | Added existing-slot action prompt (use existing / replace / delete) + connected/default hints in method picker + tests. |
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
