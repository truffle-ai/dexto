# @dexto/analytics

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution
- Updated dependencies [7cb9082]
    - @dexto/agent-management@1.6.4
    - @dexto/core@1.6.4

## 1.6.3

### Patch Changes

- @dexto/core@1.6.3
- @dexto/agent-management@1.6.3

## 1.6.2

### Patch Changes

- 669f16e: Add copy-paste and drag-drop support for multiple file attachments

    **New Features:**
    - Support for up to 5 file attachments per message (5MB each, 25MB total)
    - Copy-paste files from file manager, screenshots, and images from browser
    - Drag-drop files with visual feedback and drop overlay
    - Multiple file types supported: images, PDFs, and audio files
    - Dedicated attachment preview component with individual remove buttons
    - "Clear All" button for bulk attachment removal

    **Improvements:**
    - Comprehensive file validation with smart error messages
    - Compatible model suggestions for unsupported file types
    - File rejection analytics tracking
    - Unified file handler for consistent validation across all input methods
    - Consistent duplicate file rejection across all upload methods (paste/drop/button)
    - Defensive checks for undefined mimeType and malformed data URLs

    **Technical Changes:**
    - Refactored from single image+file to unified `Attachment[]` array
    - Updated `InputArea`, `ChatApp`, `ChatContext`, `useChat`, and `useQueue` signatures
    - Created `AttachmentPreview` component for consistent rendering
    - Added `FileRejectedEvent` analytics event
    - Helper utilities for attachment management

- 5e6383d: Add reasoning presets + reasoning trace controls across CLI/WebUI:
    - Introduce structured reasoning config (preset + optional budget tokens) with provider-aware reasoning presets (`off|low|medium|high|max|xhigh`) and validate availability via the LLM registry (including the dynamic OpenRouter catalog).
    - Map presets to provider-native knobs (e.g. OpenAI `reasoningEffort`, budget-token models) and reuse the same behavior across gateways (OpenRouter / Dexto Nova / native).
    - Rename “reasoning effort” terminology to “reasoning preset” throughout the UX.
    - CLI: Tab cycles the active reasoning preset; reasoning traces can be displayed in the transcript.
    - Add `/reasoning` overlay to toggle reasoning trace visibility and (when supported) set/clear budget tokens.
    - Enable Claude interleaved thinking for Claude 4+ models and align gateway/provider request headers so reasoning tuning behaves consistently (OpenRouter / Dexto Nova / native).
    - Improve `/model` to surface all gateway models (OpenRouter/Dexto Nova) and their reasoning capability metadata.
    - Default spawned sub-agents to reduced/no reasoning to avoid long-running spawned tasks.

- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/agent-management@1.6.2
    - @dexto/core@1.6.2

## 1.6.1

### Patch Changes

- 112dadf: - CLI/TUI: cleaner overlays (selectors, approvals, elicitation) with consistent sizing to reduce flicker on small terminals.
    - Tools: richer pre-approval previews (files/diffs, bash commands, plans) and clearer tool output formatting in message history.
    - Filesystem approvals: directory access checks now handle symlinks/realpaths consistently so approved directories actually work (e.g. `/tmp` on macOS).
    - ask_user: wizard-style elicitation flow with a deterministic schema contract (field `title`/`description` + `x-dexto.stepLabel`).
    - Reliability & build: deterministic `http_request` tests (no network) and faster builds by separating JS bundling from DTS generation.
- Updated dependencies [03d4564]
- Updated dependencies [526d906]
- Updated dependencies [112dadf]
    - @dexto/agent-management@1.6.1
    - @dexto/core@1.6.1

## 1.6.0

### Minor Changes

- facabe1: Rebuild DI + image-based config resolution

    This release rebuilds Dexto’s core/runtime to be DI-first, and moves YAML/config concerns into a dedicated adapter layer.

    **Highlights**
    - **DI-first `@dexto/core`**: `DextoAgent` is now constructed with concrete dependencies (logger, storage backends, tools, plugins, compaction strategy). Core no longer creates these from YAML.
    - **New `@dexto/agent-config` package**: owns the YAML/Zod schemas and provides the “YAML → validated config → resolved services → `DextoAgentOptions`” pipeline (including image loading + defaults).
    - **Images define the YAML surface**: agents can reference an `image:` (e.g. `@dexto/image-local`) that provides defaults + factories for tools/plugins/compaction/storage. The CLI can install/manage images in the user image store (`~/.dexto/images` by default).
    - **New `@dexto/storage` package**: extracted concrete storage implementations out of core. Core keeps storage interfaces + `StorageManager`; images/hosts provide implementations.
    - **Tools refactor**: tool packs are now configured via image tool factories; tool execution uses a required `ToolExecutionContext`. Built-in tools ship via **new** `@dexto/tools-builtins`.
    - **Agent events**: event bus is no longer exposed directly; use `agent.on()/off()` and `agent.registerSubscriber()` (server SSE/webhook subscribers updated).

    **Breaking/migration notes**
    - Programmatic usage must construct the agent via `new DextoAgent({ ...runtimeSettings, logger, storage, tools, plugins, compaction })` (the old config-first construction path is removed).
    - Config/YAML usage should go through `@dexto/agent-management` (load/enrich) + `@dexto/agent-config` (validate + resolve services + `toDextoAgentOptions()`).
    - Server “save/apply config” endpoints now rely on host-owned config paths (core no longer tracks file paths and no longer supports `agent.reload()`).

### Patch Changes

- Updated dependencies [d6b4368]
- Updated dependencies [facabe1]
- Updated dependencies [99cf1c6]
- Updated dependencies [c862605]
- Updated dependencies [8d37b8a]
- Updated dependencies [7ffa399]
    - @dexto/agent-management@1.6.0
    - @dexto/core@1.6.0

## 1.5.8

### Patch Changes

- c49bc44: Introduced multi-task orchestration with background task tools, signals, and CLI panels; improved background task summaries/logging and cancellation handling; tightened LLM override persistence/restore safeguards; and migrated LLM execution to the Responses API.
- Updated dependencies [8687817]
- Updated dependencies [fc77b59]
- Updated dependencies [9417803]
- Updated dependencies [5618ac1]
- Updated dependencies [ef90f6f]
- Updated dependencies [20a2b91]
- Updated dependencies [9990e4f]
- Updated dependencies [c49bc44]
    - @dexto/agent-management@1.5.8
    - @dexto/core@1.5.8

## 1.5.7

### Patch Changes

- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [eb71ec9]
- Updated dependencies [1960235]
    - @dexto/agent-management@1.5.7
    - @dexto/core@1.5.7

## 1.5.6

### Patch Changes

- 042f4f0: ### CLI Improvements
    - Add `/export` command to export conversations as Markdown or JSON
    - Add `Ctrl+T` toggle for task list visibility during processing
    - Improve task list UI with collapsible view near the processing message
    - Fix race condition causing duplicate rendering (mainly visible with explore tool)
    - Don't truncate `pattern` and `question` args in tool output display

    ### Bug Fixes
    - Fix build script to preserve `.dexto` storage (conversations, logs) during clean builds
    - Fix `@dexto/tools-todo` versioning - add to fixed version group in changeset config

    ### Configuration Changes
    - Remove approval timeout defaults - now waits indefinitely (better UX for CLI)
    - Add package versioning guidelines to AGENTS.md

- Updated dependencies [042f4f0]
    - @dexto/agent-management@1.5.6
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/core@1.5.5
    - @dexto/agent-management@1.5.5

## 1.5.4

### Patch Changes

- 499b890: Fix model override persistence after compaction and improve context token tracking

    **Bug Fixes:**
    - Fix model override resetting to config model after compaction (now respects session overrides)

    **Context Tracking Improvements:**
    - New algorithm uses actual `input_tokens` and `output_tokens` from LLM responses as source of truth
    - Self-correcting estimates: inaccuracies auto-correct when next LLM response arrives
    - Handles pruning automatically (next response's input_tokens reflects pruned state)
    - `/context` and compaction decisions now share common calculation logic
    - Removed `outputBuffer` concept in favor of single configurable threshold
    - Default compaction threshold lowered to 90%

    **New `/context` Command:**
    - Interactive overlay with stacked token bar visualization
    - Breakdown by component: system prompt, tools, messages, free space, auto-compact buffer
    - Expandable per-tool token details
    - Shows pruned tool count and compaction history

    **Observability:**
    - Comparison logging between estimated vs actual tokens for calibration
    - `dexto_llm_tokens_consumed` metric now includes estimated input tokens and accuracy metrics

- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4
    - @dexto/agent-management@1.5.4

## 1.5.3

### Patch Changes

- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/agent-management@1.5.3
    - @dexto/core@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [91acb03]
- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/agent-management@1.5.2
    - @dexto/core@1.5.2

## 1.5.1

### Patch Changes

- Updated dependencies [a25d3ee]
- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/agent-management@1.5.1
    - @dexto/core@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- abfe5ce: Update and standardize analytics for CLI and web UI
- Updated dependencies [ee12727]
- Updated dependencies [1e7e974]
- Updated dependencies [4c05310]
- Updated dependencies [5fa79fa]
- Updated dependencies [ef40e60]
- Updated dependencies [e714418]
- Updated dependencies [e7722e5]
- Updated dependencies [7d5ab19]
- Updated dependencies [436a900]
    - @dexto/agent-management@1.5.0
    - @dexto/core@1.5.0

## 1.4.0

### Patch Changes

- Updated dependencies [bd5c097]
- Updated dependencies [7a64414]
- Updated dependencies [3cdce89]
- Updated dependencies [d640e40]
- Updated dependencies [6f5627d]
- Updated dependencies [6e6a3e7]
- Updated dependencies [f73a519]
- Updated dependencies [c54760f]
- Updated dependencies [ab47df8]
- Updated dependencies [3b4b919]
    - @dexto/core@1.4.0
    - @dexto/agent-management@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies [e2f770b]
- Updated dependencies [f843b62]
- Updated dependencies [eb266af]
    - @dexto/core@1.3.0
    - @dexto/agent-management@1.3.0

## 1.2.6

### Patch Changes

- Updated dependencies [7feb030]
    - @dexto/core@1.2.6
    - @dexto/agent-management@1.2.6

## 1.2.5

### Patch Changes

- 5e27806: Add changeset for updated agentCard with protocol version 0.3.0
- a35a256: Migrate from WebSocket to Server-Sent Events (SSE) for real-time streaming
    - Replace WebSocket with SSE for message streaming via new `/api/message-stream` endpoint
    - Refactor approval system from event-based providers to simpler handler pattern
    - Add new APIs for session approval
    - Move session title generation to a separate API
    - Add `ApprovalCoordinator` for multi-client SSE routing with sessionId mapping
    - Add stream and generate methods to DextoAgent and integ tests for itq=

- a154ae0: UI refactor with TanStack Query, new agent management package, and Hono as default server

    **Server:**
    - Make Hono the default API server (use `DEXTO_USE_EXPRESS=true` env var to use Express)
    - Fix agentId propagation to Hono server for correct agent name display
    - Fix circular reference crashes in error logging by using structured logger context

    **WebUI:**
    - Integrate TanStack Query for server state management with automatic caching and invalidation
    - Add centralized query key factory and API client with structured error handling
    - Replace manual data fetching with TanStack Query hooks across all components
    - Add Zustand for client-side persistent state (recent agents in localStorage)
    - Add keyboard shortcuts support with react-hotkeys-hook
    - Add optimistic updates for session management via WebSocket events
    - Fix Dialog auto-close bug in CreateMemoryModal
    - Add defensive null handling in MemoryPanel
    - Standardize Prettier formatting (single quotes, 4-space indentation)

    **Agent Management:**
    - Add `@dexto/agent-management` package for centralized agent configuration management
    - Extract agent registry, preferences, and path utilities into dedicated package

    **Internal:**
    - Improve build orchestration and fix dependency imports
    - Add `@dexto/agent-management` to global CLI installation

- ac649fd: Fix error handling and UI bugs, add gpt-5.1, gemini-3
- Updated dependencies [c1e814f]
- Updated dependencies [f9bca72]
- Updated dependencies [c0a10cd]
- Updated dependencies [81598b5]
- Updated dependencies [4c90ffe]
- Updated dependencies [1a20506]
- Updated dependencies [8f373cc]
- Updated dependencies [f28ad7e]
- Updated dependencies [4dd4998]
- Updated dependencies [5e27806]
- Updated dependencies [a35a256]
- Updated dependencies [0fa6ef5]
- Updated dependencies [e2fb5f8]
- Updated dependencies [a154ae0]
- Updated dependencies [ac649fd]
    - @dexto/agent-management@1.2.5
    - @dexto/core@1.2.5

## 1.2.4

### Patch Changes

- cd706e7: bump up version after fixing node-machine-id
- Updated dependencies [cd706e7]
    - @dexto/core@1.2.4

## 1.2.3

### Patch Changes

- 5d6ae73: Bump up version to fix bugs
- Updated dependencies [5d6ae73]
    - @dexto/core@1.2.3

## 1.2.2

### Patch Changes

- 8b96b63: Add posthog analytics package and add to web ui
    - @dexto/core@1.2.2
