# Handler Refactor Plan

## Goal
Move the existing Express route logic from `packages/cli/src/api/server.ts` into framework-agnostic handler modules housed in `@dexto/server/src/handlers`. Each handler:
- Accepts a `DextoAgent` (and optional injected dependencies such as logger, token redactor, preferences accessor).
- Validates input with Zod.
- Returns plain JSON-serialisable objects or throws an `HttpError`.
- Contains no Express/Hono/Node HTTP specifics.

## Modules to create

| Handler | Responsibilities | Source of current logic |
| --- | --- | --- |
| `message.ts` | `/api/message`, `/api/message-sync`, websocket message routing; file/image payload handling | Express POST routes + WS branch |
| `session.ts` | Session CRUD (`list`, `create`, `history`, `delete`, `search`), metadata retrieval | Express routes + CLI helpers |
| `search.ts` | `/api/search`, parameter coercion, result shaping | Express search route |
| `mcp.ts` | MCP registration endpoints, config export, transport helpers | Express MCP routes |
| `llm.ts` | LLM catalog, current config, provider/router filters | Express `/api/llm/*` routes |
| `config.ts` | `/api/config.yaml`, `/api/greeting`, agent card generation (A2A) | Express config routes + `setupA2ARoutes` |
| `webhook.ts` | Webhook CRUD + test endpoint | Express webhook routes |
| `events.ts` | Event serialization for WebSocket broadcast + tool confirmation plumbing | WebSocket subscriber |

Each handler file exports:
- Zod schemas for body/query params.
- Business logic functions e.g. `postMessage(agent, input, deps)`, `listSessions(agent, filters)`, etc.
- Shared helpers reused by CLI tests or SDK (e.g., serialising LLM catalog entries).

## Dependencies passed to handlers
- `logger?: ILogger` – defaults to agent logger when omitted.
- `redact?: <T>(payload: T) => T` – for config export/webhook responses.
- `preferences?: PreferencesAccessor` – optional async accessor replacing direct file reads.
- Additional adapters can be added via a small `HandlerDeps` object to avoid pulling Node modules into handler files.

## Migration steps
1. Copy validation schemas from Express to the corresponding handler modules.
2. Replace direct `res.status().json()` calls with return values or thrown `HttpError`s.
3. Port helper logic (config YAML redaction, webhook DTO shaping, agent card creation) into the relevant handler file.
4. Update websocket logic to emit handler-produced payloads rather than mutating the `WebSocket` directly.
5. Add comprehensive unit tests for handlers using mocked `DextoAgent` + injected deps.
6. Remove duplicated code from CLI once handlers are verified.

## Error handling
- Use `HttpError` (`class HttpError extends Error { status: number; details?: unknown; }`).
- Hono wrapper catches `HttpError`, sets status, and returns JSON; unexpected errors bubble to the shared error middleware.

## Benefits
- Reusable business logic across CLI, hosted server, and client SDK tests.
- Cleaner layering: transport adapters (Hono/Node/WebSocket) only orchestrate requests and responses.
- Easier to document and generate typed clients from a single source of truth.
