# Package Structure & Responsibilities

## `@dexto/core`
- Remains the primitives + runtime services layer (agents, schemas, storage, MCP, search, event bus).
- Ships `ILogger`, `ConsoleLogger`, and lightweight factories. `DextoAgent` continues to accept only its validated config plus an injected logger.
- Drops bundled filesystem helpers (`getDextoPath`, execution context, preferences loader). Core code that previously reached into these helpers either reads values from config (with `@agent_dir` resolution handled upstream) or relies on updated FileContributor defaults that no longer depend on raw config paths.
- Storage and MCP modules stay in core; any filesystem access happens through configuration provided by the CLI/server before instantiation.
- Conditional exports:
  - `"."` → Node entry (documented as server-first).
  - `"./logger"` → interface + console implementation.
  - `"./logger/node"` → Winston/file implementation (tree-shakeable from browsers).
  - Additional node-only surfaces (storage/config/environment) stay behind explicit subpaths.

## `@dexto/server`
- New package containing:
  - `src/handlers/*` – framework-agnostic functions that operate on `DextoAgent` (no Express/Hono types).
  - `src/hono/*` – Hono app factory, routers, middleware (redaction, error handling), websocket hub, MCP adapter, typed client helper (`hc`).
  - `src/node/*` – `createNodeServer` bridge that wires `app.fetch` into `http.createServer`, performs websocket upgrades, and hands raw requests to the MCP Streamable HTTP transport.
- Published with exports map:
  ```json
  {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./hono": { "import": "./dist/hono/index.js", "types": "./dist/hono/index.d.ts" },
    "./hono/node": { "import": "./dist/hono/node.js", "types": "./dist/hono/node.d.ts" },
    "./hono/client": { "import": "./dist/hono/client.js", "types": "./dist/hono/client.d.ts" }
  }
  ```
- Owns schema validation (Zod) formerly embedded in the CLI.

## `@dexto/server/hono`
- Subpath exporting:
  - `createDextoApp(agent)` – builds the Hono app using handler modules.
  - `createNodeServer(app, options)` – wraps `app.fetch` with Node’s `http` server, websocket upgrade handling, and MCP streaming support.
  - `createWebsocketHub(agent, logger?)` – WS broadcasting + tool confirmation wiring.
  - `createTypedClient(baseUrl, init)` – generated typed client helper.
  - Middleware utilities (`redactResponse`, `withHttpErrorHandling`).

## `@dexto/cli`
- Owns YAML/config resolution, filesystem utilities (`resolveDextoPath`, execution context), preferences loader, logging configuration (`createLoggerFromConfig`), and registry macros (e.g., `@agent_dir` → absolute path).
- Preprocesses configs before creating `DextoAgent` so core no longer needs direct filesystem helpers.
- Wires the agent + Hono Node bridge to serve the API/WebUI and maintains REPL commands against the shared agent instance.

## `@dexto/client-sdk`
- Rebuilt wrapper around the typed client (`createTypedClient`).
- Provides retry/backoff, websocket conveniences, and domain helpers (sessions, messaging).
- `tsup` build outputs ESM + CJS with sourcemaps and declarations.

## Optional future packages
- Edge bundles (`@dexto/server/cloudflare`) can reuse handler modules with different adapters.
- Additional logging transports can live outside core without polluting browser bundles.

This structure keeps primitives portable while letting host code own filesystem and logging responsibilities.
