---
description: "Create a structured feature plan using PLAN + WORKING_MEMORY + USER_VERIFICATION (tasklist) files"
allowed-tools: ["bash", "read", "glob", "grep", "task"]
---

# Custom Plan (PLAN + Working Memory + Tasklist)

Create feature plans using the PLAN + Working Memory + Tasklist paradigm:
- `PLAN.md` is the source of truth (problem, goals, design, and a concrete tasklist).
- `WORKING_MEMORY.md` is the live scratchpad agents update while executing.
- `USER_VERIFICATION.md` is the owner-only decision + manual verification checklist.

## 1) Create the plan directory + files

Create a new directory:
- `feature-plans/<topic>/`

Add these three files:
- `feature-plans/<topic>/PLAN.md`
- `feature-plans/<topic>/WORKING_MEMORY.md`
- `feature-plans/<topic>/USER_VERIFICATION.md`

## 2) Write `PLAN.md` (durable, structured)

At the top, link the other two files and state the update rules:

```md
# <Title>

**Working memory:** [`WORKING_MEMORY.md`](./WORKING_MEMORY.md) — read before starting work; update after each task.
**Owner verification list:** [`USER_VERIFICATION.md`](./USER_VERIFICATION.md) — add entries for owner-only decisions or manual checks; clear before shipping.
```

Recommended sections (adapt as needed):
1. **Problem** (current behavior + pain)
2. **Goals** (explicit outcomes)
3. **Non-goals** (what you’re not doing)
4. **Constraints** (compat, deadlines, security, performance, dependencies)
5. **Proposed design** (data model, APIs, UX flows, before/after behavior)
6. **Risks / mitigations** (what can go wrong, how we’ll detect it)
7. **Tasklist** (phases + numbered tasks with exit criteria)

### Tasklist conventions

Put a single, unambiguous execution checklist in the plan:
- Use **phases** for grouping (Phase 0, Phase 1, …).
- Use **task IDs** like `0.1`, `0.2`, `1.1`, etc.
- Each task should be “commit-sized” and include **Exit criteria** that can be verified.
- Prefer task text that names concrete files/symbols/commands.

Example task shape:

```md
## <N>. Tasklist

### Phase 0 — Foundation
> Goal: <one sentence>

- [ ] **0.1 <Task title>**
  - Deliverables: <files, routes, UI screens, commands>
  - Exit: <tests/commands/manual checks that prove it’s done>
```

### Owner-only decisions

If you hit any unresolved decision that requires product judgment, credentials, or manual local verification:
- Add an item to `USER_VERIFICATION.md` immediately.
- Keep the main plan unblocked by marking the decision as deferred to verification.

## 3) Write `WORKING_MEMORY.md` (live scratchpad)

Purpose: capture what’s currently being worked on, what changed, and what was learned.

Recommended structure:

```md
# Working Memory — <Topic>

> Live scratchpad for agents working through `PLAN.md`. Read before starting work. Update after each task.

## How to use this file
1. Before starting: read Current Task + Key Decisions.
2. When starting a task: set Current Task (task ID + plan).
3. During: log findings/blockers/decisions in Notes.
4. After finishing: move it to Completed Tasks and set the next Current Task.
5. When you discover owner-only decisions/manual checks: add to `USER_VERIFICATION.md`.

## Current Task
**Task:** <id + title>
**Status:** <in progress | blocked | waiting on owner | done>
**Branch:** <branch name>

### Plan
- <bullets>

### Notes
<dated log entries>

## Key Decisions
| Date | Decision | Reasoning |
|------|----------|-----------|
| YYYY-MM-DD | … | … |

## Open Questions / Blockers
- …

## Completed Tasks
| Task | Title | Date | Notes |
|------|-------|------|-------|
| 0.1 | … | YYYY-MM-DD | … |
```

## 4) Write `USER_VERIFICATION.md` (owner checklist)

Use this when something is:
- owner judgment (tradeoffs, “which option”), or
- manual verification (OAuth flows, API keys, smoke tests, UI polish), or
- environment-dependent (ports, external services).

Recommended structure:

```md
# Owner Verification — <Topic>

## Open Items
| ID | Item | Why owner-only | Target phase | Status | Notes |
|----|------|----------------|--------------|--------|-------|
| UV-1 | … | … | 2.3 | Open | … |

## Resolved Items
| ID | Decision / Verification | Date | Notes |
|----|--------------------------|------|-------|
| UV-0 | … | YYYY-MM-DD | … |
```

## 5) Committing changes in `feature-plans/` (gitignored)

`feature-plans/` is gitignored, so you must force-add updates when committing.

Stage explicitly (no `git add .` / `-A`):

```bash
# Non-ignored files stage normally
git add .claude/commands/custom-plan.md

# Feature plans must be force-added
git add -f feature-plans/<topic>

git diff --staged
git commit -m "docs(feature-plans): <topic> plan updates"
```

For the rest of the session: **commit every time you change anything under `feature-plans/`** using `git add -f feature-plans/<topic>` so the updates don’t get lost.
