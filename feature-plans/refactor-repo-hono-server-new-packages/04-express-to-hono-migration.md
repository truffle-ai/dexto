# Express → Hono Migration

## Current state
- Express app defined in `packages/cli/src/api/server.ts` with routes for health, messaging, sessions, search, LLM catalog, MCP config, webhooks, and A2A.
- Custom websocket implementation using `ws` directly.
- MCP Streamable HTTP transport bound to Express `req`/`res` handlers.
- Middleware for redaction, Zod validation inline.

## Target state
- Hono app constructed via `createDextoApp(agent)` in `@dexto/server/hono`, mirroring the existing route surface.
- Node bridge (`createNodeServer`) adapts `app.fetch` to `http.createServer`, handles websocket upgrades, and forwards raw requests to the MCP transport.
- WebSocket hub (`createWebsocketHub`) sits alongside the Node bridge, managing connections and tool confirmation flow against `agent.agentEventBus`.
- Middleware (redaction, error handling) implemented as Hono middleware functions.

## Migration steps
> This is a direct port; once merged, the CLI ships with the Hono implementation exclusively.

1. **Extract handlers** (see `02-handler-refactor.md`).
2. **Create Hono routers** under `packages/server/src/hono/routers`:
   - `messages`, `sessions`, `search`, `llm`, `config`, `mcp`, `webhooks`, `health`.
   - Routes call handler functions and attach optional OpenAPI metadata.
3. **Implement `createDextoApp`**:
   - Register middleware (JSON body parsing, redaction, error handling).
   - Mount routers under `/api/*` plus `/.well-known/agent.json`.
   - Register `/health` endpoint.
4. **Node bridge** (`createNodeServer`):
   - Wrap `app.fetch` using `http.createServer` for Node environments.
   - On `upgrade`, delegate to `createWebsocketHub` (which wraps `ws` and uses the agent event bus).
   - For MCP routes (`/mcp`), forward Node `IncomingMessage`/`ServerResponse` to `StreamableHTTPServerTransport.handleRequest`, including SSE header negotiation and raw body parsing.
5. **CLI swap**:
   - Replace Express bootstrap with the new bridge: `const app = createDextoApp(agent); const server = createNodeServer(app, { logger, port });`.
   - Share the injected logger with the hub.
   - Ensure Next.js static serving continues via the Node server.
6. **WebSocket flow**:
   - `createWebsocketHub` owns tool confirmation responses, redaction, and broadcast events identical to the current subscriber.
   - CLI passes the hub into the Node bridge; SDK connections remain unchanged (`ws://.../ws`).
7. **Error pipeline**:
   - Hono middleware catches `HttpError` and maps to JSON.
   - Node bridge logs upgrade/stream errors via the injected logger.
8. **Testing**:
   - Run CLI integration tests against the Hono server.
   - Add targeted tests for websocket broadcasting and MCP HTTP/SSE flows (using supertest + ws where possible).

## Considerations
- Body parsing: Hono handles JSON; file uploads still need evaluation (current API expects base64 payloads, so no multipart requirement yet).
- Static assets for WebUI served by the Node bridge via a simple file handler or existing Next.js server.
- Node bridge is opinionated for now; future edge adapters can re-export the handlers without Node-specific code.

## Rollback plan
- Keep Express implementation in a branch until the Hono path is stable. No runtime toggle will be maintained post-merge.
