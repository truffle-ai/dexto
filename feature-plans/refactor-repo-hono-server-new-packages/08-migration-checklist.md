# Migration Checklist

## Pre-work
- [ ] Align team on package renames/exports (`@dexto/server`, `@dexto/server/hono`).
- [ ] Freeze Express changes in CLI to avoid churn during migration.

## Phase 1 – Handlers & Utilities
- [ ] Create `packages/server` scaffolding.
- [ ] Move validation + route logic from CLI to handler modules.
- [ ] Add unit tests for each handler.
- [ ] Relocate path/execution helpers from `@dexto/core` to `packages/cli/src/utils/runtime.ts`.
- [ ] Implement `createLoggerFromConfig` in CLI utilities.

## Phase 2 – Hono App
- [ ] Build `createDextoApp`, routers, websocket hub.
- [ ] Implement `createRuntimeContextFactory`.
- [ ] Implement `createTypedClient` helper.
- [ ] Add integration tests for key endpoints (`/api/message`, `/api/sessions`, `/api/search`, `/ws`).
- [ ] (Optional) Hook up OpenAPI generation script.

## Phase 3 – CLI Swap
- [ ] Replace Express server with Hono app + Node adapter.
- [ ] Update logging injection to use helper and pass logger into context factory.
- [ ] Wire websocket hub to agent event bus.
- [ ] Ensure WebUI static assets still serve correctly.
- [ ] Run CLI integration suite.

## Phase 4 – Client SDK & WebUI
- [ ] Update SDK to use typed client.
- [ ] Update SDK tests to spin up Hono app.
- [ ] Verify bundle size/compatibility.
- [ ] Adjust WebUI API calls if needed (base URL, endpoints).
- [ ] Update docs referencing CLI endpoints.

## Phase 5 – Cleanup & Release
- [ ] Delete Express code paths and unused middleware.
- [ ] Update release notes highlighting package changes, logging configuration, and new API entrypoint.
- [ ] Publish updated packages (`@dexto/core`, `@dexto/server`, `@dexto/client-sdk`, CLI version bump).
- [ ] Notify downstream teams (webui, RN, hosted) about new integration points.
- [ ] Monitor for regressions; keep rollback branch handy.

## Post-migration follow-ups
- [ ] Explore hosted/edge deployment using the new server package.
- [ ] Flesh out monetization features (API keys, rate limiting).
- [ ] Consider additional transports (gRPC, SSE) once Hono foundation is stable.
