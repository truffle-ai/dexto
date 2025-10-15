# Tool Result Media Handling Plan

## Scope & Context
- **Objective**: Deliver a unified flow for capturing, persisting, and rendering tool results, with explicit support for video/audio/media payloads returned by MCP tools.
- **Out of scope**: Backward compatibility shims for legacy stored histories; we will migrate the codebase to the new structure in a single update.
- **Stakeholders**: Core platform, WebUI, CLI subscribers, storage/resource management teams.

## Current Pain Points
- Raw MCP payloads reach the WebUI before sanitization, forcing ad-hoc parsing and losing blob references on reload.
- `sanitizeToolResultToContentWithBlobs` mixes sanitization with blob persistence and emits inconsistent shapes (strings, raw objects, arrays of mixed types).
- Stored conversation history contains `@blob:*` markers that the UI never resolves, so videos/audio vanish after refresh.
- Event subscribers (WebSocket, CLI) forward unsanitized objects, leading to divergence between runtime display and persisted history.

## Design Principles
- **Single source of truth**: Define a canonical `SanitizedToolResult` schema that all layers share.
- **Separation of concerns**: Split structural normalization from blob/resource storage; each stage has a clear contract.
- **Deterministic rehydration**: Stored tool messages must render identically after reload without special-case logic.
- **Strong typing & validation**: Enforce the schema via TypeScript interfaces and Zod validators, plus regression tests.

## Target Architecture
### Canonical Types
- Introduce `SanitizedToolResult` describing:
  - `parts`: `TextPart | ImagePart | FilePart` (no bare strings). Media intent is expressed via `filePart.mediaKind` (`'audio' | 'video' | 'binary'`) and `mimeType`.
  - `resources`: array of `{ uri, kind, mimeType, filename?, mediaKind? }` when blobs are externalized.
  - `meta`: `{ toolName, toolCallId, success }`.
- Extend `FilePart` typing to include optional `mediaKind`; update shared schemas in core + web accordingly. `AudioPart`/`VideoPart` types are not introduced to keep parity with MCP.

### Sanitization Pipeline
1. **Normalization (`normalizeToolResult`)**: Pure function converting raw tool payload into valid parts/resources without side effects.
2. **Persistence (`persistToolMedia`)**: Stores large media via `ResourceManager`, returning updated parts with `@blob:` refs or resource descriptors.
3. **Packaging (`buildSanitizedToolResult`)**: Combines normalized parts + persisted resource metadata and returns the canonical shape.

### Storage & History
- `ContextManager.addToolResult` persists the sanitized payload and writes a fully typed `tool` message into session history.
- History API returns stored messages as-is; `DextoAgent.getSessionHistory` no longer needs to guess at blob references (but can still expand lazily for LLM formatting).

### Event Flow & Consumers
- LLM services (`openai`, `anthropic`, `vercel`) await the sanitized result and emit `llmservice:toolResult` events with `{ toolName, callId, success, sanitized }`.
- WebSocket & CLI subscribers forward the sanitized payload only; raw tool responses stay internal or behind debug logging.
- WebUI `useChat` consumes the new schema directly, removing current normalization code. Media rendering relies on `useResourceContent` for `resources` entries.
- Optional raw payload emission is gated by environment flag `DECTO_DEBUG_TOOL_RESULT_RAW` (set to `true`/`1` to include `rawResult` for debugging).

### UI Rendering & Rehydration
- Tool result messages in React render from `parts`; video/audio detection uses `mediaKind` (or `mimeType`) rather than ad-hoc inference.
- Referenced `resources` are fetched via existing `/api/resources/:uri/content` endpoint.
- `loadSessionHistory` hydrates identical structures, ensuring videos/audio survive reloads.

## Implementation Phases & Tracking
| Phase | Goal | Key Tasks | Owner | Status |
| --- | --- | --- | --- | --- |
| 0 | Author canonical schemas | Draft TypeScript interfaces for `SanitizedToolResult`, extend `FilePart` with `mediaKind`, align shared typing. | TBD | ✅ |
| 1 | Refactor sanitization | Extract normalization/persistence helpers, update `sanitizeToolResultToContentWithBlobs` callers, add unit tests. | TBD | ✅ |
| 2 | Update event emitters | Change `ContextManager.addToolResult` to return sanitized payload and update LLM services + subscribers. | TBD | ✅ |
| 3 | WebUI integration | Simplify `useChat` + `MessageList` to consume canonical data; adjust `useResourceContent`. | TBD | ✅ |
| 4 | Validation & docs | Add regression tests (core + web), update CLAUDE.md with new flow, validate build/test/lint. | TBD | ☐ |

Use checkboxes to reflect progress as phases complete.

## Task Breakdown
- [x] Define `SanitizedToolResult` & extend message part types (`core/context/types.ts`, shared packages).
- [x] Implement `normalizeToolResult` + pure tests (cover MCP resource, raw media, video cases).
- [x] Implement `persistToolMedia` leveraging `ResourceManager` and return resource descriptors.
- [x] Update `ContextManager.addToolResult` to use new helpers and persist canonical messages.
- [x] Adjust LLM services to emit sanitized payloads; update websocket + CLI subscribers.
- [x] Simplify WebUI hooks/components to consume canonical result data; remove custom normalization.
- [ ] Add integration test simulating video tool output end-to-end (core + WebUI hydration).
- [ ] Document flow in CLAUDE.md (appendix on tool result handling) once implementation stabilizes.

## Risks & Mitigations
- **Large payload handling**: Ensure we stream/store videos without keeping base64 inline; confirm blob store thresholds via tests.
- **Schema drift**: Add contract tests ensuring sanitized payloads round-trip between storage, websocket events, and UI rehydration.
- **Timeline creep**: Track the phase checklist weekly; block merges on schema + event contract completion.

## Open Questions
- Do we want optional raw payload logging for debugging (behind env flag)? - ✅ Gated behind `DECTO_DEBUG_TOOL_RESULT_RAW`
- Should resource descriptors include size/duration hints for UI preloading? - If its not a big overhead, sure.
- Any provider-specific limits we must encode (e.g., video size caps for different LLMs)? - Not needed for now.

---
_This document is the living source for design/implementation updates. Please update phase status, task checkboxes, and notes as work progresses._
