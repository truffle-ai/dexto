## Context

Upstream 1.13.4 has a text-only headless command. The August local refactor added structured output together with much larger server and lifecycle changes. Recover only the output behavior and improve its terminal failure handling.

## Goals / Non-Goals

Goals: parseable stdout, one terminal result, incremental JSONL events, unchanged default text behavior.

Non-goals: new runtime packages, remote runs, permission changes, server changes, and Cloud-specific logic.

## Decisions

- Use Commander choices for `--format`, defaulting to text. Unsupported formats fail before constructing an agent.
- Keep event serialization beside existing headless rendering. One stream feeds human diagnostics and the selected stdout format; no second execution path.
- JSON writes one object with `version: 1`, `status`, optional session/content/token fields, and an error on failure. JSONL writes selected message/tool/warning/error events followed by exactly one `complete` or `error` result containing final content when available.
- Recoverable stream errors do not fail a run that subsequently completes. Startup failures and missing final responses produce structured failures; a final response followed by a fatal error remains failed.
- Preserve current exit codes (0 success, 1 task failure). Stable categorized exit codes are a later slice.

## Risks / Trade-offs

- Structured events can contain tool arguments and assistant content; consumers must handle them like existing text output.
- Third-party bootstrap logging could contaminate stdout. Keep the existing silent headless logger and cover the command process with deterministic mocks before claiming clean output.
- Approval defaults remain unchanged in this additive slice. Explicit execution policy is the next behavioral slice.

## Migration Plan

Opt in with `--format json` or `--format jsonl`. Existing invocations continue using text. Reverting the CLI-only patch restores the previous behavior without changing durable state or Core contracts.
