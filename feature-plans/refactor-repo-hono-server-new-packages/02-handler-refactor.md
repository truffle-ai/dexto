# Handler Refactor Plan

## Goal
Move Express route logic from `packages/cli/src/api/server.ts` into framework-agnostic handler modules housed in `@dexto/server/src/handlers`. Each handler:
- Accepts a `RuntimeContext` (agent, logger, services).
- Validates input with Zod.
- Returns plain JSON serialisable objects (or throws `HttpError`).
- Contains no Express/Hono-specific APIs.

## Modules to create

| Handler | Responsibilities | Source of current logic |
| --- | --- | --- |
| `message.ts` | `/api/message`, `/api/message-sync`, `/api/message-stream` logic; input validation, file/image payload handling | Express POST routes |
| `session.ts` | Session CRUD (`list`, `create`, `history`, `delete`, `search`), metadata retrieval | Express POST/GET routes + CLI helpers |
| `search.ts` | `/api/search`, parameter coercion, result shaping | Express search route |
| `mcp.ts` | MCP registration endpoints, config endpoints | Express MCP routes |
| `llm.ts` | LLM provider/model catalog, router introspection, key status, updates | Express `/api/llm/*` routes |
| `events.ts` | Event serialization for WebSocket broadcast (`agent`, `session` events) | WebSocket subscriber |
| `webhook.ts` | Webhook registration/trigger endpoints (if needed) | Express webhook route |

Each handler file exports:
- `Zod` schemas for body/query params.
- Business logic functions `postMessage(ctx, input)`, `listSessions(ctx)`, etc.
- Utility helpers (e.g., serializing search results) shared between API and CLI where relevant.

## Runtime context
Defined in `src/runtime-context.ts`:
```ts
export interface RuntimeContext {
  agent: DextoAgent;
  logger: ILogger;
  eventBus: AgentEventBus;
  preferences: PreferenceLoader;
  storageManager?: StorageManager;
  mcpManager?: MCPManager;
}
```
Context is created per request by the Hono factory and can be extended as needed.

## Migration steps
1. Copy validation schemas from Express to corresponding handler modules.
2. Replace direct Express response calls (`res.status().json`) with return values.
3. Replace CLI-specific calls (e.g., `loadMostRecentSession`) with agent service methods; surface utilities (formatting) through shared helper modules if still needed by CLI.
4. Add comprehensive unit tests for handlers using mocked agent/context.
5. Remove duplicated code from CLI once handlers are verified.

## Error handling
- Use `HttpError` (`class HttpError extends Error { status: number; details?: unknown; }`).
- Hono wrapper catches `HttpError`, sets status, and returns JSON; unexpected errors return 500 with safe message.

## Benefits
- Reusable business logic across CLI, hosted server, client SDK tests.
- Cleaner layering: Hono/Express becomes presentation only.
- Easier to document and generate typed clients from a single source of truth.
