# Logger and Browser Safety Plan

> **Update:** The active implementation plan now lives in `core-logger-browser-plan.md` and `03-logging-config.md`. This document remains as tactical guidance but avoid introducing new base classes—prefer injected loggers with console defaults.

Status: Draft (tactical guidance now; implementation later)

## Problem Statement
- `@dexto/core` currently includes a Node-only logger (Winston + fs/path + file IO).
- If browser consumers (our Web UI or external apps) import any module that depends on this logger (directly or via a root re-export), bundlers can attempt to include Node-only code and fail.
- Today, our Web UI imports only types and a small util (`toError`), so bundlers tree-shake away the logger. This is workable but fragile if future UI imports add runtime helpers.

## Goals
- Keep file-based logging as the default behavior for Node (good DX, persistent logs).
- Keep logs visible in browser (console-based), not a no-op.
- Avoid wide refactors and call-site changes for consumers.
- Make `@dexto/core` ergonomic for both Node and browser consumers.

## Recommended Approach (Mastra-style)

1) Environment-Aware Logging Boundary
- Provide two implementations of the same logger API:
  - Browser: Console logger (no fs/path; prints to console; safe for UIs)
  - Node: Current file-based Winston logger (existing behavior)
- Wire resolution at package boundary so consumers don’t change imports:
  - Option A (preferred): Subpath with conditional exports
    - Export logging at `@dexto/core/logger`
    - `exports` map uses `browser` condition to point to the console implementation for web, and Node implementation for everything else.
  - Option B: `browser` field in package.json
    - Map `./dist/logger/index.js` to `./dist/logger/browser.js` for browser builds, leaving Node untouched.
    - Pros: minimal changes; Cons: less explicit than subpaths.

2) Keep the Root Export Browser-Safe
- Continue to expose types and UI-safe helpers at `@dexto/core`.
- Keep Node-only domains on subpaths (e.g., `@dexto/core/storage`, `@dexto/core/config`, `@dexto/core/agent/registry`).
- If discoverability is needed from root, export thin “warning” wrappers that advise importing from subpaths (no Node imports inside the wrappers).

3) Top-Level Orchestrator (Optional)
- Introduce a top-level `Dexto` object (analogous to Mastra’s `Mastra`) that:
  - Accepts a `logger` in its constructor/config
  - Injects it into sub-services (`__setLogger`, constructor params) such as MCP manager, storage, workflows, etc.
  - Keeps consumer code simple and avoids importing Node-only modules in UI code.

4) Tactical Safety (Now)
- Web UI should import only types and `toError` from `@dexto/core` using `import type { ... } from '@dexto/core'`.
- All runtime interactions should go through the API, not direct Core imports.
- This avoids bundling Node code while we prepare the environment-aware logger split.

## Migration Plan (Phased)

Phase 0 — Guardrails (no API changes)
- Enforce UI imports to be type-only from `@dexto/core`.
- Disallow `@core/*` or non-type imports in the UI via lint rules.

Phase 1 — Logger Split (minimal surface)
- Create `logger/browser.ts` with a console-based logger implementing the same API.
- Add `@dexto/core/logger` subpath with conditional exports:
  - `browser` → `dist/logger/browser.js`
  - `default`/`node` → `dist/logger/index.js` (Winston file logger)
- Verify both Node CLI and a minimal Next app build successfully while importing `@dexto/core/logger`.

Phase 2 — Curate Root Exports
- Keep root `@dexto/core` browser-safe by default; do not re-export Node-only modules.
- If needed, export “warning” wrappers to guide developers toward the correct subpaths.

Phase 3 — Optional Orchestrator
- Add `Dexto` class that takes a `logger` (and other runtime config) and propagates it to sub-services.
- Consumers in Node can pass a Winston-backed logger or defaults; browser consumers get console logs automatically.

## Import Safety Rules
- Browser-safe modules must not import Node built-ins or Node-only deps.
- Top-level side-effects in Node-only code must not live in root export paths.
- Prefer subpaths for server-only domains.
- Types should be exported from root (types are erased at compile time; safe for UIs).

## Verification Checklist
- Build succeeds:
  - Node/CLI build (unchanged logging behavior; file logs work)
  - Minimal Next/Vite app importing `@dexto/core` types and `@dexto/core/logger` compiles and runs (console logs)
- Tree-shaking validated: root import of types does not pull Node logger.
- CI job for a tiny browser build (sanity check) to catch regressions.

## Alternatives Considered
- Large refactor to extract all Node-only into separate packages — overkill for now.
- No-op logger in browser — rejected (we want visible logs in UIs).

## Open Questions
- Do we want a separate `@dexto/loggers` package (like `@mastra/loggers`)? Optional later for advanced transports.
- Which browser bundlers/versions do we target with conditional exports? Test with Next, Vite, Webpack.

## Summary
- Short term: UI consumes types-only + `toError` and talks to Core via API.
- Medium term: Add environment-aware logger resolution so browser consumers can safely import more helpers without breaking builds, while Node keeps file-based logging defaults.
