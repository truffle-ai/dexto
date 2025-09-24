# Migration Checklist

This file tracks the Express → Hono migration across packages. The list below reflects the current state after recent work to gate Hono behind a feature flag, validate REST + WebSocket behaviour, and fix several migration bugs.

## Phase 0 – Feature Flag + Validation (new)
- [x] Introduce feature flag `DEXTO_USE_HONO` to toggle between Express and Hono in the CLI.
- [x] Gate WebSocket path on Hono (`/ws`) and keep Express behaviour unchanged.
- [x] Wire WebUI dev server to select WS URL based on `DEXTO_USE_HONO`.
- [x] Update `scripts/install-global-cli.ts` to pack and install `@dexto/server` locally alongside core + CLI.
- [x] Validate REST endpoints with `scripts/test_api.sh` in both modes (Express and Hono).
- [x] Validate WebSocket flows with `scripts/test_websocket.js` in both modes (Express and Hono, using `/ws` for Hono).
- [x] Fix Hono error handling to return 400 for Zod/validation errors (previously 500), via `app.onError` and standardized JSON responses.
- [x] Fix Hono WebSocket broadcasting by emitting the `connection` event on the `WebSocketServer` and subscribing the broadcaster there (so `thinking/chunk/response` frames reach clients).
- [x] Keep Express WebSocket semantics: require `sessionId` for error frames; for malformed JSON, log only, don’t emit frames.


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
- [x] Port Express routes into Hono route modules (messages, sessions, search, LLM, config, MCP,
      webhooks, health, A2A) with inline Zod validation.
- [x] Implement shared middleware (redaction, error handling) and register them in
      `createDextoApp`.
- [ ] Add `/openapi.json` endpoint powered by `@hono/zod-openapi` descriptors defined in the route
      modules.
 - [ ] (Optional) After OpenAPI is stable, consider replacing parseJson/parseQuery with `@hono/zod-validator` middleware to reduce handler boilerplate while keeping centralized error handling.
- [x] Reuse existing websocket + webhook subscribers inside the Node bridge to keep event flow
      identical.
- [x] Ensure MCP transport integration works through the Hono bridge (HTTP handlers + transport wiring confirmed in logs).
- [ ] *(Optional)* Add Hono route/unit tests that replace `scripts/test_api.sh` and legacy Express integration suites.

## Phase 4 – CLI Swap
- [x] Add feature‑flagged switch in the CLI to run either Express or Hono paths (`DEXTO_USE_HONO`).
- [ ] Replace Express server bootstrap with `@dexto/server/hono` in the CLI (`startApiServer`) permanently.
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
- [ ] Deprecate the `DEXTO_USE_HONO` feature flag and remove the runtime toggle.
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

---

## Completed bug fixes discovered during validation
- [x] Hono: use `app.onError` and map Zod/validation errors to 400; return standardized JSON.
- [x] Hono: ensure `WebSocketServer` emits `connection` so broadcaster registers clients; route unknown/invalid messages consistently.
- [x] Hono: guard WebSocket upgrades to `/ws`; Express remains permissive (any path).
- [x] Dev tooling: `scripts/dev-server.ts` sets WS URL based on `DEXTO_USE_HONO`.
- [x] Installer: include `@dexto/server` tarball in `scripts/install-global-cli.ts` to avoid npm registry fetch.
- [x] Test scripts: update `scripts/test_websocket.js` expectations for Hono vs Express, and `scripts/test_api.sh` status codes for validation cases.

## To‑do before deprecating Express
- [ ] Unify WS URL configuration for embedded WebUI builds (document that `NEXT_PUBLIC_WS_URL` is baked at build time; ensure `install-cli` builds with correct env).
- [ ] Verify WebUI against Hono-only path on multiple platforms (macOS/Windows browsers).
- [ ] Run a full pass of CLI and WebUI manual QA with `DEXTO_USE_HONO=true`.
- [ ] Cut a prerelease with Hono default enabled for broader testing.
