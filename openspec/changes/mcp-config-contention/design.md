# Design

## Context

See proposal.md for the observed two-process lost edit. The existing CLI owns a complete YAML load/mutate/write transaction, but POSIX atomic replacement only protects individual commits. No reusable repository lock dependency exists. Core owns neither these files nor process-scoped configuration edit policy.

## Goals / Non-Goals

**Goals:** exclusive cooperating CLI edit ownership, immediate actionable contention outcomes, truthful cleanup failure and cross-platform release.

**Non-Goals:** external-editor conflict detection, automatic retries, stale-lock reclamation, process identity heuristics, shared Core state or filesystem security frameworks.

## Decisions

Acquire the sibling `<config>.lock` with exclusive file creation and private POSIX mode before loading YAML. Both add and remove participate. Retain the file handle through commit, close it before unlinking for Windows, and release only an acquired lock in finally. Existing lock files are never inspected, modified or reclaimed. An existing sidecar maps to safe `config_busy`/exit 2; other failures retain sanitized configuration diagnostics. Create the parent for add; preserve remove's missing-configuration error.

Ownership is scoped to the selected pathname and sibling lock, not canonical inode identity. Keep read-only commands unlocked and preserve the existing platform-specific writer. The lock serializes cooperating writers, while the existing writer continues to own privacy/commit semantics. Optimistic compare-before-write was rejected because comparison and commit are separate operations and can still race. PID/age-based stealing was rejected because age and PID reuse cannot establish safe ownership.

A release failure returns exit 2 with `config_lock_cleanup_failed` and explicitly states that configuration may already have changed. When the edit already failed, its original error is preserved. Closing and unlinking are both attempted; cleanup cannot be silently reported as success.

Use a test-only Node preload to pause a real CLI process after its YAML snapshot read. A second actual CLI process demonstrates the baseline lost edit and then the new busy outcome. No production test hook or provider calls are needed.

## Risks / Trade-offs

- Abrupt termination can leave a sidecar: require explicit operator removal only when no CLI edit is active; never auto-steal.
- External editors ignore the lock: document cooperating-writer scope without claiming universal conflict detection.
- Cleanup may fail after commit: return truthful failure rather than implying the mutation did not occur.
- Windows in-place reader behavior remains unchanged: the lock does not claim atomic snapshots for unlocked readers.
