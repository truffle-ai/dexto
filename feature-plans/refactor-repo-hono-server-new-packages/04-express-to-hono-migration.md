# Express → Hono Migration

## Current state
- Express app defined in `packages/cli/src/api/server.ts` with routes for health, messaging,
  sessions, search, LLM catalog, MCP config, webhooks, and A2A.
- Custom websocket implementation using `ws` directly.
- MCP Streamable HTTP transport bound to Express `req`/`res` handlers.
- Middleware for redaction, Zod validation inline.

## Target state
- Hono app constructed via `createDextoApp(agent)` in `@dexto/server/hono`, mirroring the existing
  route surface.
- Node bridge (`createNodeServer`) adapts `app.fetch` to `http.createServer`, handles websocket
  upgrades, and forwards raw requests to the MCP transport.
- WebSocket hub (`createWebsocketHub`) sits alongside the Node bridge, managing connections and tool
  confirmation flow against `agent.agentEventBus`.
- Middleware (redaction, error handling) implemented as Hono middleware functions.
- Automatic OpenAPI generation using `@hono/zod-openapi` descriptors inside the route modules.

## Migration steps
> We are keeping transport + business logic together inside the Hono route modules for now. A
> future “handlers” layer can be introduced later if we need additional transports.

1. **Port routes**
   - Recreate each Express endpoint within `packages/server/src/hono/routes/*`, wiring Zod schemas
     for input/output.
   - Preserve behaviour (status codes, response shapes, streaming) to keep the CLI + WebUI working.
2. **Shared middleware**
   - Implement redaction and error middleware in Hono equivalents.
   - Ensure MCP JSON/YAML responses respect the same redaction rules.
3. **Create `createDextoApp`**
   - Register middleware, mount routers under `/api/*`, add health + `.well-known/agent.json`.
   - Expose `/openapi.json` (built from the route descriptors).
4. **Node bridge** (`createNodeServer`):
   - Wrap `app.fetch` for Node, mirror websocket upgrade handling, and forward MCP requests to
     `StreamableHTTPServerTransport.handleRequest`.
   - Reuse the existing `WebSocketEventSubscriber`/`WebhookEventSubscriber` to keep event flow
     unchanged.
5. **CLI swap**:
   - Replace Express bootstrap with the new bridge: `const app = createDextoApp(agent); const
     { server } = createNodeServer(app, { port, websocket: … });`.
   - Keep Next.js static serving functional.
6. **Testing**:
   - Run the CLI integration tests against the Hono server.
   - Add targeted tests for websocket broadcasting and MCP flows (supertest + ws where possible).

## Considerations
- Body parsing: Hono handles JSON; file uploads still evaluated (current API expects base64, so no
  multipart requirement).
- Static assets for WebUI served by the Node bridge via the existing Next.js server.
- Node bridge remains opinionated for now; future edge adapters can reuse the same route modules.

## Rollback plan
- Keep the Express implementation in a branch until the Hono path is stable. No runtime toggle will
  be maintained post-migration.
