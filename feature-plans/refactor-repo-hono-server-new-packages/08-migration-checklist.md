# Migration Checklist

## Pre-work
- [ ] Align on updated `DextoAgent` surface (config + logger) and remove legacy singleton usage.
- [ ] Freeze Express changes in CLI to avoid churn during migration.

## Phase 1 – Utility Migration & Config Normalisation
- [ ] Move filesystem helpers (`getDextoPath`, execution context, preferences loader) from core to CLI (`packages/cli/src/utils/runtime.ts`, `preferences.ts`).
- [ ] Implement config normalisation (`normaliseFileContributors`, registry macro expansion) so agents receive absolute paths.
- [ ] Add unit tests for the new runtime utilities.

## Phase 2 – Logger & FileContributor Refactor
- [ ] Introduce `ILogger`, `ConsoleLogger`, and node-only `WinstonLogger` subpath.
- [ ] Update `DextoAgent` and `createAgentServices` to accept injected logger only.
- [ ] Replace singleton logger imports across core/CLI with injected instances.
- [ ] Update FileContributor defaults + docs to remove `configDir` assumptions; rely on normalised paths from Phase 1.
- [ ] Add tests validating logger injection and contributor path handling.

## Phase 3 – Handlers & Server Package
- [ ] Scaffold `@dexto/server` (handlers, Hono routers, middleware, typed client helper).
- [ ] Port validation + route logic from CLI to handler modules operating on `DextoAgent`.
- [ ] Implement `createWebsocketHub` and MCP adapter utilities.
- [ ] Add unit tests for handlers and websocket hub.

## Phase 4 – Hono App & Node Bridge
- [ ] Build `createDextoApp` with redaction + error middleware.
- [ ] Implement `createNodeServer` (http bridge + websocket upgrade + MCP stream handling).
- [ ] Generate typed client helper (`createTypedClient`).
- [ ] Add integration tests for `/api/message`, `/api/sessions`, `/api/search`, `/api/webhooks`, `/mcp`, `/ws`.
- [ ] (Optional) Hook up OpenAPI generation script.

## Phase 5 – CLI Swap
- [ ] Replace Express server with Hono app + Node bridge.
- [ ] Ensure config preprocessing (absolute paths, preferences) runs before `DextoAgent` instantiation.
- [ ] Reuse `createWebsocketHub` for REPL + API event streaming.
- [ ] Ensure WebUI static assets still serve correctly.
- [ ] Run CLI integration suite.

## Phase 6 – Client SDK & WebUI
- [ ] Rebuild client SDK around `createTypedClient`.
- [ ] Update SDK tests to spin up the Hono bridge.
- [ ] Verify bundle size/compatibility (browser + RN smoke tests).
- [ ] Adjust WebUI API calls if needed.
- [ ] Update docs referencing CLI endpoints/SDK usage.

## Phase 7 – Cleanup & Release
- [ ] Delete Express code paths and unused middleware.
- [ ] Update release notes highlighting package changes, logger injection, and new API entrypoints.
- [ ] Publish updated packages (`@dexto/core`, `@dexto/server`, `@dexto/client-sdk`, CLI version bump`).
- [ ] Notify downstream teams (webui, RN, hosted) about new integration points.
- [ ] Monitor for regressions; keep rollback branch handy.

## Post-migration follow-ups
- [ ] Explore hosted/edge deployments using the new server package.
- [ ] Flesh out monetization features (API keys, rate limiting).
- [ ] Consider additional transports (gRPC, SSE streams) once the Hono foundation is stable.
