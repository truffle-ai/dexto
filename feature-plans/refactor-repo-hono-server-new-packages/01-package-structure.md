# Package Structure & Responsibilities

## `@dexto/core`
- Remains the primitives + runtime services layer (agents, schemas, storage, MCP, search, event bus).
- Ships `ILogger`, `ConsoleLogger`, and lightweight factories. `DextoAgent` continues to accept only
  its validated config plus an injected logger.
- Drops bundled filesystem helpers (`getDextoPath`, execution context, preferences loader). Core code
  that previously relied on config-path lookups instead receives pre-normalised data (e.g., file
  contributors already hold absolute paths, registry macros resolved upstream).
- Storage and MCP modules stay in core; any filesystem access happens through values already baked
  into the config or supplied by host services.
- Conditional exports:
  - `"."` → Node entry (documented as server-first).
  - `"./logger"` → interface + console implementation.
  - `"./logger/node"` → Winston/file implementation (tree-shakeable from browsers).
  - Additional node-only surfaces (storage/config/environment) stay behind explicit subpaths.

## `@dexto/server`
- New package containing:
  - `src/hono/*` – Hono app factory, route modules (with Zod validation + OpenAPI descriptors),
    middleware (redaction, error handling), websocket hub, MCP adapter, and typed client helper.
  - `src/hono/node/*` – Node bridge that wires `app.fetch` into `http.createServer`, performs
    websocket upgrades, and hands raw requests to the MCP Streamable HTTP transport.
- Route modules currently encapsulate both transport and business logic. We will add a comment in
  each file noting that the logic can be extracted into a `handlers/` directory if future transports
  require it.
- Published with exports map:
  ```json
  {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./hono": { "import": "./dist/hono/index.js", "types": "./dist/hono/index.d.ts" },
    "./hono/node": { "import": "./dist/hono/node.js", "types": "./dist/hono/node.d.ts" },
    "./hono/client": { "import": "./dist/hono/client.js", "types": "./dist/hono/client.d.ts" }
  }
  ```
- Owns schema validation (Zod) formerly embedded in the CLI and the generated OpenAPI spec.

## `@dexto/server/hono`
- Subpath exporting:
  - `createDextoApp(agent)` – builds the Hono app (middleware + routes).
  - `createNodeServer(app, options)` – wraps `app.fetch` with Node’s `http` server, websocket
    upgrade handling, and MCP streaming support.
  - `createWebsocketHub(agent, logger?)` – WS broadcasting + tool confirmation wiring (reused from
    current Express setup).
  - `createTypedClient(baseUrl, init)` – generated typed client helper.
  - Middleware utilities (`redactResponse`, `withHttpErrorHandling`).

## `@dexto/cli`
- Owns YAML/config resolution, filesystem utilities, preferences loader, logging configuration
  (`createLoggerFromConfig`), and registry path expansion.
- Normalises configs (e.g., resolves relative file contributor paths to absolute) before instantiating
  `DextoAgent`, so core stays free of filesystem lookups.
- Wires the agent + Hono Node bridge to serve the API/WebUI and maintains REPL commands against the
  shared agent instance.

## `@dexto/client-sdk`
- Rebuilt wrapper around the generated Hono client (`createTypedClient`).
- Provides retry/backoff, websocket conveniences, and domain helpers (sessions, messaging).
- `tsup` build outputs ESM + CJS with sourcemaps and declarations.

## Optional future packages
- Edge bundles (e.g., `@dexto/server/cloudflare`) can reuse the same Hono app with minimal glue.
- Additional logging transports can live outside core without polluting browser bundles.

This structure keeps primitives portable while letting host code own filesystem and logging responsibilities.
