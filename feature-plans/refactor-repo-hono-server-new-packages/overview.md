# Refactor Dexto Runtime: Hono Server & Package Split

## Why this refactor?

- **API logic locked in the CLI**: Express routes, validation, and event streaming live in `packages/cli/src/api/server.ts`. Any consumer (web app, hosted deployment) must embed the CLI to access the API.
- **Bundler issues**: Core utilities import Node built-ins (logger path utils, execution context). Browser targets must tiptoe around the root export.
- **Fragmented client story**: The new `@dexto/client-sdk` wraps the CLI endpoints manually, duplicating types and logic.
- **Logger monolith**: A Winston singleton drags `fs`/`path` into every import, forcing consumers to opt out manually.
- **Future goals**: Support hosted agents, a monetizable API, and cleaner deployment targets (edge-friendly Hono app, typed client generation).

## High-level solution

1. **Re-scope packages**
   - `@dexto/core`: primitives plus runtime services (agent, storage, MCP) with a console-first logger default. Node helpers (`getDextoPath`, env resolution, preferences loader, config discovery) move to the CLI; `DextoAgent` only depends on its validated config and an injected logger. File contributor paths are normalised to absolute strings before config reaches the agent—no runtime path resolution needed in core.
   - `@dexto/server`: handler modules plus Hono/Node adapters. Exposes a typed API surface, websocket hub, and an MCP adapter that works with Hono’s request/response objects.
   - `@dexto/server/hono`: subpath exporting the Hono app factory, Node server bridge (HTTP + WS upgrade), websocket hub, MCP transport helpers, and generated typed client tooling.
   - `@dexto/cli`: owns YAML parsing, filesystem helpers, preferences, logging configuration, registry path expansion, and the Node bootstrap wiring the server + REPL.
   - `@dexto/client-sdk`: rebuilt as a thin wrapper over the generated typed client with retries and websocket conveniences.
2. **Logging injection**
   - `@dexto/core` ships an `ILogger` contract with `ConsoleLogger` default. `WinstonLogger` lives behind a node-only subpath. `DextoAgent` accepts a logger and propagates it to every service during construction.
   - Hosts (CLI/server) build file loggers via YAML/env and pass them in. No singleton imports remain.
3. **Move Node-only utilities out of core**
   - Path resolution, execution-context detection, preferences loader, and `.dexto` helpers migrate to the CLI and run before instantiating the agent. The CLI ensures any filesystem-based config (file contributors, tool paths) is fully resolved ahead of time.
4. **Express → Hono + Node bridge**
   - Express code is replaced with a Hono app built from handler modules. A Node bridge (`createNodeServer`) adapts `app.fetch` to `http.createServer` and owns the websocket upgrade + MCP streamable HTTP wiring.
5. **Typed client & docs**
   - Use `hono/client` (`hc`) to generate a typed client. Client SDK wraps it. Optional OpenAPI metadata keeps docs/tests in sync.

## Impacted user flows

- CLI REPL continues to run locally, but the internal API now comes from `@dexto/server/hono` via the Node bridge.
- WebUI and hosted deployments talk to the same API surface.
- Client SDK becomes the recommended integration path.
- Logging configuration lives in YAML/env with injection into the agent; defaults remain consistent (`~/.dexto` or project `.dexto`).

## Detailed breakdown

1. `01-package-structure.md` – package responsibilities, injection boundaries, and exports.
2. `02-handler-refactor.md` – extracting logic into agent-driven handlers.
3. `03-logging-config.md` – logger interface, implementations, and host wiring.
4. `04-express-to-hono-migration.md` – server migration plus Node bridge and websocket/MCP adapters.
5. `05-client-sdk.md` – SDK rebuild around the typed client.
6. `06-cli-impact.md` – CLI utility moves, config normalisation, and API wiring.
7. `07-api-docs.md` – OpenAPI/typed client generation.
8. `08-migration-checklist.md` – consolidated task list.
9. `09-usage-examples.md` – sample code for CLI, server, and SDK consumers.
10. `core-logger-browser-plan.md` – logger refactor details.
11. `logger-migration.md` & `logger.md` – legacy notes kept for historical context.

Refer to these documents as implementation proceeds.
