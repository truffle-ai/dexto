# Migration Checklist

## Pre-work
- [ ] Align on updated `DextoAgent` surface (config + logger) and remove legacy singleton usage
      *(deferred; not required for the first Hono cut).* 
- [ ] Freeze Express changes in CLI to avoid churn during migration.

## Phase 1 – Utility Migration & Config Normalisation
- [x] Update FileContributor defaults + docs to remove `configDir` assumptions; rely on normalised
      paths from Phase 1.
- [x] Move CLI-only runtime helpers (API key store, layered env loader, port utils) from core to
      `packages/cli/src/runtime/*` with colocated tests.
- [ ] (Deferred) Move preferences loader/schemas/errors into the CLI runtime and update CLI commands
      to consume them.
- [ ] (Deferred) Move agent resolution + registry helpers (resolveAgentPath, getAgentRegistry, etc.)
      into the CLI runtime, normalising paths before agent creation.
- [ ] (Deferred) Introduce a CLI config normaliser that resolves file contributor paths, registry
      macros, and storage defaults before instantiating `DextoAgent`.
- [ ] (Deferred) Add/refresh unit tests covering the migrated preferences/registry/config normaliser
      utilities.

## Phase 2 – Logger & FileContributor Refactor (Deferred)
- [ ] Introduce `ILogger`, `ConsoleLogger`, and node-only `WinstonLogger` subpath.
- [ ] Update `DextoAgent` and `createAgentServices` to accept injected logger only.
- [ ] Replace singleton logger imports across core/CLI with injected instances.
- [ ] Add tests validating logger injection and contributor path handling.

## Phase 3 – Hono Server Package
- [x] Scaffold `@dexto/server` with Hono app factory and Node bridge skeleton.
- [ ] Port Express routes into Hono route modules (messages, sessions, search, LLM, config, MCP,
      webhooks, health, A2A) with inline Zod validation.
- [ ] Implement shared middleware (redaction, error handling) and register them in
      `createDextoApp`.
- [ ] Add `/openapi.json` endpoint powered by `@hono/zod-openapi` descriptors defined in the route
      modules.
- [ ] Reuse existing websocket + webhook subscribers inside the Node bridge to keep event flow
      identical.
- [ ] Ensure MCP transport integration works through the Hono bridge (streamable HTTP + SSE).

## Phase 4 – CLI Swap
- [ ] Replace Express server bootstrap with `@dexto/server/hono` in the CLI (`startApiServer`).
- [ ] Ensure config preprocessing (absolute paths, preferences) still runs before `DextoAgent`
      instantiation.
- [ ] Reuse `createWebsocketHub`/subscribers for REPL + API event streaming.
- [ ] Ensure WebUI static assets still serve correctly via Next.js + the Node bridge.
- [ ] Run CLI integration suite and smoke test WebUI/websocket flows.

## Phase 5 – Client SDK & WebUI
- [ ] Rebuild client SDK around the generated Hono client (`hc`) using the OpenAPI spec.
- [ ] Update SDK tests to spin up the Hono bridge.
- [ ] Verify bundle size/compatibility (browser + RN smoke tests).
- [ ] Adjust WebUI API calls if needed.
- [ ] Update docs referencing CLI endpoints/SDK usage.

## Phase 6 – Cleanup & Release
- [ ] Delete Express code paths and unused middleware.
- [ ] Update release notes highlighting package changes, logger injection (once done), and new API
      entrypoints.
- [ ] Publish updated packages (`@dexto/core`, `@dexto/server`, `@dexto/client-sdk`, CLI version bump).
- [ ] Notify downstream teams (webui, RN, hosted) about new integration points.
- [ ] Monitor for regressions; keep rollback branch handy.

## Post-migration follow-ups
- [ ] Explore hosted/edge deployments using the new server package (Cloudflare, Vercel, Netlify).
- [ ] Flesh out monetization features (API keys, rate limiting).
- [ ] Consider additional transports (gRPC, SSE streams) once the Hono foundation is stable.
