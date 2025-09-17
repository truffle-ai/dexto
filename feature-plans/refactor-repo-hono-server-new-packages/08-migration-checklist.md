# Migration Checklist

## Pre-work
- [ ] Align on updated `DextoAgent` surface (config + logger) and remove legacy singleton usage.
- [ ] Freeze Express changes in CLI to avoid churn during migration.

## Phase 1 – Core & Utilities
- [ ] Introduce `ILogger`, `ConsoleLogger`, and node-only `WinstonLogger` subpath.
- [ ] Update `DextoAgent` and `createAgentServices` to accept injected logger only.
- [ ] Relocate filesystem + preferences utilities to CLI; update FileContributor/docs to rely on `@agent_dir` expansion.
- [ ] Add unit tests covering logger injection and config preprocessing.

## Phase 2 – Handlers & Server Package
- [ ] Scaffold `@dexto/server` (handlers, Hono routers, middleware, typed client helper).
- [ ] Port validation + route logic from CLI to handler modules operating on `DextoAgent`.
- [ ] Implement `createWebsocketHub` and MCP adapter utilities.
- [ ] Add unit tests for handlers and websocket hub.

## Phase 3 – Hono App & Node Bridge
- [ ] Build `createDextoApp` with redaction + error middleware.
- [ ] Implement `createNodeServer` (http bridge + websocket upgrade + MCP stream handling).
- [ ] Generate typed client helper (`createTypedClient`).
- [ ] Add integration tests for `/api/message`, `/api/sessions`, `/api/search`, `/api/webhooks`, `/mcp`, `/ws`.
- [ ] (Optional) Hook up OpenAPI generation script.

## Phase 4 – CLI Swap
- [ ] Replace Express server with Hono app + Node bridge.
- [ ] Ensure config preprocessing (macros, preferences) runs before `DextoAgent` instantiation.
- [ ] Reuse `createWebsocketHub` for REPL + API event streaming.
- [ ] Ensure WebUI static assets still serve correctly.
- [ ] Run CLI integration suite.

## Phase 5 – Client SDK & WebUI
- [ ] Rebuild client SDK around `createTypedClient`.
- [ ] Update SDK tests to spin up the Hono bridge.
- [ ] Verify bundle size/compatibility (browser + RN smoke tests).
- [ ] Adjust WebUI API calls if needed.
- [ ] Update docs referencing CLI endpoints/SDK usage.

## Phase 6 – Cleanup & Release
- [ ] Delete Express code paths and unused middleware.
- [ ] Update release notes highlighting package changes, logging injection, and new API entrypoints.
- [ ] Publish updated packages (`@dexto/core`, `@dexto/server`, `@dexto/client-sdk`, CLI version bump).
- [ ] Notify downstream teams (webui, RN, hosted) about new integration points.
- [ ] Monitor for regressions; keep rollback branch handy.

## Post-migration follow-ups
- [ ] Explore hosted/edge deployments using the new server package.
- [ ] Flesh out monetization features (API keys, rate limiting).
- [ ] Consider additional transports (gRPC, SSE streams) once the Hono foundation is stable.
