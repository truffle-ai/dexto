# Package Structure & Responsibilities

## `@dexto/core`
- Remains the primitives layer (agents, schemas, result helpers, safe-stringify, etc.).
- Ships a lightweight `ILogger` interface plus `ConsoleLogger`/`WinstonLogger` implementations. `DextoAgent` owns a `logger` property and accepts overrides via constructor options.
- All Node-only utilities (path resolution, execution context) move out.
- Conditional exports:
  - `"."` → Node entry (still documented as Node-focused).
  - `"./index.browser"` (if retained) or `index.browser.ts` trimmed to the SDK/UI-safe surface.
  - Node-specific surfaces (storage, config, env) available as explicit subpaths.

## `@dexto/server`
- New package containing:
  - `src/runtime-context.ts` – typed context shared across handlers.
  - `src/errors.ts` – `HttpError`/`HttpException` wrappers.
  - `src/handlers/*` – framework-agnostic functions for messages, sessions, search, MCP, events.
  - `src/hono/*` – Hono app factory, routers, websocket hub, context factory, typed client helper (`hc`).
- Published with exports map:
  ```json
  {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./hono": { "import": "./dist/hono/index.js", "types": "./dist/hono/index.d.ts" },
    "./hono/client": { "import": "./dist/hono/client.js", "types": "./dist/hono/client.d.ts" }
  }
  ```
- Responsible for schema validation (Zod) previously in CLI.

## `@dexto/server/hono`
- Subpath (no separate package) exporting:
  - `createDextoApp(createContext)`
  - `createRuntimeContextFactory(options)`
  - `createTypedClient(baseUrl, init)`
  - `createWebsocketHub` helper for WS upgrade.
- Consumers: CLI, dedicated server deployments, tests, client SDK typed client generation.

## `@dexto/cli`
- Owns YAML/resolution logic, path utilities, logging helper (`createLoggerFromConfig`).
- Uses `createRuntimeContextFactory` + `createDextoApp` to expose API/Web UI.
- REPL commands continue to call `DextoAgent` directly but share the same agent instance.

## `@dexto/client-sdk`
- Wraps generated typed client (`createTypedClient`) from server subpath.
- Adds retry, websocket convenience, and domain-specific helpers.
- `tsup` build outputs CJS + ESM with sourcemaps, TS declarations.

## Optional future packages
- Edge-specific bundles (`@dexto/server/cloudflare`?) can re-export handler modules if necessary.
- Telemetry/logging transports can live in dedicated packages without polluting core.

This structure keeps primitives portable for browser use while letting host code own Node-only concerns.
