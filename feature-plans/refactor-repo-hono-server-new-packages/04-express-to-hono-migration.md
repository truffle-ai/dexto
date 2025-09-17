# Express → Hono Migration

## Current state
- Express app defined in `packages/cli/src/api/server.ts` with a small set of routes (health, message/message-sync, session CRUD/search, LLM catalog, MCP configuration, webhook).
- Custom websocket implementation using `ws` directly.
- Middleware for redaction, Zod validation inline.

## Target state
- Hono app constructed via `createDextoApp(createContext)` in `@dexto/server/hono`, mirroring the existing route surface one-for-one.
- WebSocket upgrades handled by a single hub (`createWebsocketHub`) using `ws` (Node) initially, with future compatibility for edge runtimes.
- Middleware (redaction, error handling) implemented as Hono middleware functions.

## Migration steps
> This is a direct lift-and-shift of the existing Express routes. No backward-compatibility layer is planned; once merged, the CLI ships with the Hono implementation exclusively.
1. **Extract handlers** (see `02-handler-refactor.md`).
2. **Create Hono routers** under `packages/server/src/hono/routers`:
   - `session.ts`, `search.ts`, `llm.ts`, `mcp.ts`, `webhook.ts`, etc.
   - Each router mounts handler functions and attaches OpenAPI metadata (optional).
3. **Implement `createDextoApp`**:
   - Register middleware (JSON parsing, redaction, error handler).
   - Mount routers under `/api/*` routes.
   - Register `/health` endpoint.
   - Wire websocket upgrade route `/ws`.
4. **Context factory**: `createRuntimeContextFactory` builds `RuntimeContext` per request (reusing the shared `DextoAgent` instance from the host).
5. **Replace Express in CLI**:
   - Remove Express import and initialization.
   - Use `createDextoApp` and a Node adapter (`app.fetch` via `@hono/node-server` helper or simple wrapper) to serve HTTP.
   - Reuse existing static file serving (Next.js/React app) either via Hono `serveStatic` middleware or a lightweight custom handler.
6. **WebSocket**:
   - Replace `WebSocketServer` instantiation with `createWebsocketHub` that subscribes to `agent.agentEventBus`.
   - Update tool confirmation flow if it depended on the Express-specific websocket.
7. **Error pipeline**:
   - Implement Hono middleware to catch thrown `HttpError` and map to JSON responses.
   - Ensure unhandled errors return a safe 500 response.
8. **Testing**:
   - Run existing CLI integration tests against the Hono server.
   - Add tests for websocket broadcast and API endpoints.

## Considerations
- `expressRedactionMiddleware` becomes a Hono middleware middleware under `/api/llm` and `/api/config.yaml` routes.
- Body parsing: Hono handles JSON automatically; multipart/file uploads may require additional middleware or manual parsing.
- Static assets for WebUI can be served via `serveStatic` in Hono or a separate Next.js dev server. Evaluate current deployment pipeline before replacing.

## Timeline
- Extract handlers (Phase 1).
- Build Hono subpath (Phase 2).
- Swap CLI to Hono (Phase 3); run regression suite.

## Rollback plan
- Keep Express implementation in a branch until Hono path is battle-tested.
