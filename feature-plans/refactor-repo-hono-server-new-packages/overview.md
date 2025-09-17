# Refactor Dexto Runtime: Hono Server & Package Split

## Why this refactor?

- **API logic locked in the CLI**: Express routes, validation, and event streaming live in `packages/cli/src/api/server.ts`. Any consumer (web app, hosted deployment) must embed the CLI to access the API.
- **Bundler issues**: Core utilities import Node built-ins (logger path utils, execution context). Browser targets must tiptoe around the root export.
- **Fragmented client story**: The new `@dexto/client-sdk` wraps the CLI endpoints manually, duplicating types and logic.
- **Logger monolith**: A Winston singleton drags `fs`/`path` into every import, forcing consumers to opt out manually.
- **Future goals**: Support hosted agents, a monetizable API, and cleaner deployment targets (edge-friendly Hono app, typed client generation).

## High-level solution

1. **Re-scope packages**
   - `@dexto/core`: primitives only (agents, types, pure utilities). No filesystem dependencies.
   - `@dexto/server`: handler modules + runtime context.
   - `@dexto/server/hono`: subpath exposing the Hono app factory, context factory, websocket hub, and generated typed client.
   - `@dexto/cli`: consumes server subpath, keeps REPL.
   - `@dexto/client-sdk`: thin wrapper around the generated Hono client.
   - *No backwards-compatibility shims: Express is fully replaced by the Hono implementation once the migration lands.*
2. **Logging injection**
   - Agents default to console logging (browser-safe).
   - Hosts (CLI/server) build file loggers from YAML/env and inject them.
3. **Move Node-only utilities out of core**
   - Path resolution, execution-context detection, `.dexto` directory helpers migrate to CLI (shared runtime file). Server package reuses the CLI helper when needed.
4. **Express → Hono**
   - Express-specific code replaced with a Hono app built from handler modules. WebSocket events and REST endpoints share one implementation.
   - Migration is a direct port of the existing lightweight routes (health, message, session, search, MCP, LLM); no behavioural changes or compatibility shims are introduced.
5. **Typed client & docs**
   - Use `hono/client` (`hc`) to generate a fully typed client. Client SDK wraps it. Optional OpenAPI generation from Hono routes keeps docs/tests in sync.

## Impacted user flows

- CLI REPL continues to run locally, but the internal API now comes from `@dexto/server/hono`.
- WebUI and hosted deployments talk to the same API surface, making it easier to scale beyond the CLI.
- Client SDK becomes the recommended way for consumer apps to integrate (browser-friendly).
- Logging configuration lives in YAML/env; defaults remain consistent (`~/.dexto` or project `.dexto`).

## Detailed breakdown

1. `01-package-structure.md` – package responsibilities and exports.
2. `02-handler-refactor.md` – how we extract Express logic into pure handlers.
3. `03-logging-config.md` – logging configuration and injection strategy.
4. `04-express-to-hono-migration.md` – step-by-step server migration.
5. `05-client-sdk.md` – SDK alignment and typed client usage.
6. `06-cli-impact.md` – CLI utility moves and API wiring.
7. `07-api-docs.md` – OpenAPI/typed client generation.
8. `08-migration-checklist.md` – consolidated task list.
9. `09-usage-examples.md` – sample code for CLI, server, and SDK consumers.
10. `core-logger-browser-plan.md` – active logger refactor plan (console default + injected transports).
11. `logger-migration.md` & `logger.md` – legacy notes kept for historical context.

Refer to these documents as implementation proceeds.
