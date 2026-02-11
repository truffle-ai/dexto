# Owner Verification — DI Refactor

> **This file tracks owner-only decisions and manual verifications that we defer while implementing.**
> Agents should keep it up to date throughout the refactor.

---

## How to use this file

1. **When a decision is deferred:** Add an item under “Open Items” with a short description and the reason it needs owner input.
2. **When a manual verification is required:** Add an item (e.g., “run manual smoke test”, “confirm API behavior”, “choose between options A/B”).
3. **During implementation:** If you add a TODO in code/docs that requires owner sign‑off, also add it here (so it doesn’t get lost).
4. **Before Phase 6 (platform):** Review this list and resolve/close everything, or explicitly defer items to a follow‑up plan.

---

## Open Items

| ID | Item | Why owner-only | Target phase | Status | Notes |
|----|------|----------------|--------------|--------|-------|
| — | — | — | — | — | — |

---

## Resolved Items

| ID | Decision / Verification | Date | Notes |
|----|--------------------------|------|-------|
| UV-1 | Remove `ImageTarget` / `ImageConstraint` types | 2026-02-11 | No runtime usage; keep `metadata.target`/`metadata.constraints` as plain `string`/`string[]` fields. |
