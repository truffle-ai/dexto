# Core Logger & Subpath Export Overhaul

## Executive Summary

We are re-architecting `@dexto/core` so the default runtime is browser-tolerant while Node-specific behaviour remains opt-in. The current singleton Winston logger pulls `fs`, `path`, and other Node-only dependencies into every consumer, making otherwise pure utilities unusable in browser contexts. This plan replaces the singleton with an interface-driven console logger by default, re-homes the Winston/file implementation behind an explicit subpath, and curates `package.json` exports so Node-only modules are only reachable through clearly named entry points.

## Background & Motivation

- **Repeated bundler failures:** The Web UI (`packages/webui`) and the React Native experiments both blew up with `Module not found: Can't resolve 'fs' in @dexto/core/src/logger/logger.ts` as soon as we imported `resolveAgentPath` or `loadAgentConfig`. Those modules are logically environment-neutral; the crashes are solely because they transitively pull in the file logger.
- **Measured blast radius:** `rg "from '../logger" packages/core/src | wc -l` currently reports **19** distinct modules relying on the singleton. That list includes `utils/path.ts`, `service-initializer.ts`, `storage-manager.ts`, `session-manager.ts`, and `llm/registry.ts`, so any consumer touching those features inherits Node-only baggage.
- **DX slowdown:** Contributors now hesitate to add helpers to `@dexto/core` because they are unsure whether the root export remains browser-safe. The kludgy `index.browser.ts` only exports a handful of utilities and types; everything else requires tribal knowledge about which imports are safe.
- **Mastra comparison:** Mastra’s core defaults to a console logger and exposes heavier transports from `@mastra/loggers`. Their structure confirms the value of an injectable base class and explicit subpath exports—we are aiming for the same separation without the warning wrappers or legacy baggage.

## Goals

- Default `@dexto/core/logger` is console-backed and safe for browser bundles.
- File/Winston logging remains available for CLI/server use via a dedicated `@dexto/core/logger/file` subpath.
- Core services (agent, storage, MCP, sessions, etc.) consume loggers via a base class rather than importing a singleton.
- `@dexto/core` export map documents and enforces which modules are environment-agnostic vs. Node-only.
- Browser and Node consumers can each import only what they need, without accidental dependency on Node built-ins.

## Non-Goals

- Building an entirely browser-safe `@dexto/core` root export. The package can still expose Node-only modules, but they must be opt-in.
- Retaining backwards compatibility with the current `logger` singleton import paths.
- Reworking CLI UX beyond adopting the new logger injection model.

## Current Pain Points

| Area | Issue | Impact |
| --- | --- | --- |
| Logger singleton (`packages/core/src/logger/logger.ts`) | Imports Winston, `fs`, `path`, `boxen`, and auto-instantiates a file logger. | Any module importing `logger` breaks browser builds. |
| Utilities/Services | Dozens of files (`utils/path.ts`, `service-initializer.ts`, `storage-manager.ts`, etc.) import the singleton. | Broad swaths of `@dexto/core` become Node-only despite mostly pure logic. |
| Exports | Root export still points to Node index; browser shim only covers a limited safe subset and diverges from actual usage. | Bundlers rely on tree-shaking luck; future additions easily break UI builds. |

## Proposed Architecture

### 1. Logger Module Layout

- Introduce `packages/core/src/logger/types.ts` with an `ILogger` interface and shared types (levels, structured payloads).
- Replace `logger/index.ts` exports with:
  - `ConsoleLogger` (new implementation using `console` only).
  - `createLogger` factory returning `new ConsoleLogger(...)`.
  - `NoopLogger` (optional utility for silent operation/testing).
- Move the existing Winston/file implementation to `logger/file-logger.ts` exporting `WinstonLogger` and configuration helpers.
- Provide structured metadata (context, color hints) through the interface so both console and Winston versions can render consistently.

### 2. Agent & Service Logger Injection

- Give `DextoAgent` a `logger: ILogger` property initialised to `new ConsoleLogger()`.
- Provide `__setLogger(logger: ILogger)` and `getLogger()` helper methods for host overrides.
- Update services that previously imported the singleton logger to receive a logger instance via constructor arguments or configuration objects (e.g., `new StorageManager({ logger, ... })`).
- Remove all direct `import { logger }` usages. For one-off helpers (e.g., `utils/path.ts`) either:
  - Accept an optional `ILogger` parameter, or
  - Switch to pure logic without logging if not essential.

### 3. Runtime Injection Points

- CLI (`packages/cli/src/index.ts`) creates `new WinstonLogger({ logFile, level, ... })`, calls `agent.__setLogger(...)`, and passes the logger into any other services it instantiates directly.
- Provide a helper `createNodeLogger(config)` inside `logger/file-logger.ts` to centralize Winston transport setup.
- Server-side hosts or SDK consumers can follow the same pattern— import `@dexto/core/logger/file` when they want persistent logging.

### 4. Export Map Redesign

We will make the export map explicit so consumers must opt into Node-only modules. The shape is modelled after Mastra’s wildcard exports but annotated for browser vs. Node usage.

```jsonc
{
  "name": "@dexto/core",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js" // documented as Node-oriented
    },
    "./logger": {
      "types": "./dist/logger/index.d.ts",
      "default": "./dist/logger/index.js" // ConsoleLogger (browser-safe)
    },
    "./logger/file": {
      "types": "./dist/logger/file-logger.d.ts",
      "default": "./dist/logger/file-logger.js" // Winston + fs/path
    },
    "./agent": {
      "types": "./dist/agent/index.d.ts",
      "default": "./dist/agent/index.js"
    },
    "./storage": {
      "types": "./dist/storage/index.d.ts",
      "default": "./dist/storage/index.js"
    },
    "./config": {
      "types": "./dist/config/index.d.ts",
      "default": "./dist/config/index.js"
    },
    "./env": {
      "types": "./dist/utils/env/index.d.ts",
      "default": "./dist/utils/env/index.js"
    }
  }
}
```

Why this matters:

- **Explicit semantics:** Consumers can no longer accidentally drag Winston/`fs` in via the default `logger` export—the file logger lives behind `@dexto/core/logger/file`.
- **Bundler clarity:** Build tools have an unambiguous map of which entry points are Node-only. Browser builds that accidentally hit `./storage` will still fail fast, but the path name makes intent obvious.
- **Tree shaking predictability:** Wildcard exports (`./*`) are avoided for Node-only modules; this prevents bundlers from speculatively analysing directories that contain `fs` imports.

Once the export map is updated and documentation is live, delete `index.browser.ts`; all browser-safe modules will already be reachable via the standard subpaths.

### 5. Documentation & Guidance

- Publish a doc update covering:
  - How to import the console logger vs. file logger.
  - Which subpaths are browser-safe (`logger`, most `utils`, type exports) vs. Node-only (`storage`, `config`, `env`).
  - Migration guide for existing consumers (import `@dexto/core/logger/file` instead of default `logger`).
- Update README snippets and CLI docs to use the new APIs.

## Workstreams & Tasks

### A. Foundational Types & Implementations
1. Add `logger/types.ts` and migrate common enums/interfaces.
2. Implement `ConsoleLogger`, `NoopLogger`, and `WinstonLogger` (moved code) under the new structure.
3. Replace `logger/index.ts` exports with the new surface.

### B. Service Injection
1. Update each core service class to accept an `ILogger` (via constructor/config object) instead of importing the singleton.
2. Ensure `DextoAgent` passes its logger to dependent services (storage manager, MCP manager, tool manager, session manager, etc.).
3. Adjust helper modules (e.g., `utils/service-initializer.ts`, `storage/storage-manager.ts`) to accept injected loggers or operate without logging where feasible.

### C. Runtime Wiring
1. Update `DextoAgent` constructor to accept an optional `ILogger` and store it on the instance.
2. Ensure `createAgentServices` uses the agent’s logger (passing it down) instead of importing `logger` directly.
3. Modify CLI startup to instantiate `WinstonLogger` and inject it into the agent (and any early utilities requiring logging).

### D. Export Map & Structure
1. Edit `packages/core/package.json` exports to include the new subpaths and remove unused conditions.
2. Verify build output puts each implementation in `dist` with matching paths (tsup config adjustments if needed).
3. Remove `index.browser.ts` (or shrink it to a legacy stub that re-exports console-only modules until fully removed).

### E. Cleanup & Docs
1. Delete unused browser logger stub (`logger/browser.ts`) once the console logger is canonical.
2. Update docs (`docs/docs/architecture`, CLI README) to describe the new logger story and subpath usage.
3. Add release notes summarizing breaking changes and migration steps for consumers.

## Testing Strategy

- **Unit tests**: cover `ConsoleLogger`, `WinstonLogger` wrapper, and injection pathways (agent override, service constructors).
- **Integration tests**: run existing CLI tests to ensure logs still land on disk and console output remains readable.
- **Browser smoke**: add/refresh a small Vite/Next test case that imports `@dexto/core/logger`, `@dexto/core/agent` (without file logger) and confirms the bundle builds.
- **Type tests**: ensure exported types still resolve (`pnpm test --filter core -- --runInBand` or tsd if needed).

## Risks & Mitigations

- **Missed singleton imports**: Search (`rg "from '../logger"`) before merging; add ESLint rule or codemod to prevent future singleton usage.
- **CLI regression**: Ensure the CLI explicitly injects the Winston logger before any service uses it; add regression tests for log file creation.
- **Export map mistakes**: Double-check `dist` layout after `tsup` build; consider adding a build check that verifies resolved paths for `logger` and `logger/file`.

## Rollout Plan

1. Land foundational logger changes and base class in a single PR (breaking change announcement in changelog).
2. Update services/CLI and export map in the same PR if practical; otherwise, stage in quick succession within the same release branch.
3. Publish documentation updates concurrently with the release.
4. Coordinate with downstream consumers (web UI, RN app) to adjust imports before releasing to npm.

## Deliverables

- Updated `logger/` directory with `ConsoleLogger`, `WinstonLogger`, and shared types.
- Services updated to accept injected loggers (no more singleton imports).
- Revised package export map reflecting new subpaths.
- CLI modified to inject the Winston logger.
- Documentation and release notes covering new import paths and browser guidance.
