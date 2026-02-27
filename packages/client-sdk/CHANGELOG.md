# @dexto/client-sdk

## 1.6.2

## 1.6.1

### Patch Changes

- 112dadf: - CLI/TUI: cleaner overlays (selectors, approvals, elicitation) with consistent sizing to reduce flicker on small terminals.
    - Tools: richer pre-approval previews (files/diffs, bash commands, plans) and clearer tool output formatting in message history.
    - Filesystem approvals: directory access checks now handle symlinks/realpaths consistently so approved directories actually work (e.g. `/tmp` on macOS).
    - ask_user: wizard-style elicitation flow with a deterministic schema contract (field `title`/`description` + `x-dexto.stepLabel`).
    - Reliability & build: deterministic `http_request` tests (no network) and faster builds by separating JS bundling from DTS generation.

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

## 1.5.8

## 1.5.7

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

## 1.5.5

## 1.5.4

## 1.5.3

## 1.5.2

## 1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

## 1.4.0

## 1.3.0

### Minor Changes

- eb266af: Migrate WebUI from next-js to vite. Fix any typing in web UI. Improve types in core. minor renames in event schemas

## 1.2.6

## 1.2.5

### Patch Changes

- 8f373cc: Migrate server API to Hono framework with feature flag
    - Migrated Express server to Hono with OpenAPI schema generation
    - Added DEXTO_USE_HONO environment variable flag (default: false for backward compatibility)
    - Fixed WebSocket test isolation by adding sessionId filtering
    - Fixed logger context to pass structured objects instead of stringified JSON
    - Fixed CI workflow for OpenAPI docs synchronization
    - Updated documentation links and fixed broken API references

- f28ad7e: Migrate webUI to use client-sdk, add agents.md file to webui,improve types in apis for consumption
- a35a256: Migrate from WebSocket to Server-Sent Events (SSE) for real-time streaming
    - Replace WebSocket with SSE for message streaming via new `/api/message-stream` endpoint
    - Refactor approval system from event-based providers to simpler handler pattern
    - Add new APIs for session approval
    - Move session title generation to a separate API
    - Add `ApprovalCoordinator` for multi-client SSE routing with sessionId mapping
    - Add stream and generate methods to DextoAgent and integ tests for itq=

- 5a26bdf: Update hono server to chain apis to keep type info, update client sdk to be fully typed
- ac649fd: Fix error handling and UI bugs, add gpt-5.1, gemini-3

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

- @dexto/core@1.2.2

## 1.2.1

### Patch Changes

- @dexto/core@1.2.1

## 1.2.0

### Patch Changes

- Updated dependencies [b51e4d9]
- Updated dependencies [a27ddf0]
- Updated dependencies [155813c]
- Updated dependencies [1e25f91]
- Updated dependencies [3a65cde]
- Updated dependencies [5ba5d38]
- Updated dependencies [930a4ca]
- Updated dependencies [ecad345]
- Updated dependencies [930d75a]
    - @dexto/core@1.2.0

## 1.1.11

### Patch Changes

- 01167a2: Refactors
- Updated dependencies [c40b675]
- Updated dependencies [015100c]
- Updated dependencies [0760f8a]
- Updated dependencies [5cc6933]
- Updated dependencies [40f89f5]
- Updated dependencies [3a24d08]
- Updated dependencies [01167a2]
- Updated dependencies [a53b87a]
- Updated dependencies [24e5093]
- Updated dependencies [c695e57]
- Updated dependencies [0700f6f]
- Updated dependencies [0a5636c]
- Updated dependencies [35d48c5]
    - @dexto/core@1.1.11

## 1.1.10

### Patch Changes

- @dexto/core@1.1.10

## 1.1.9

### Patch Changes

- Updated dependencies [27778ba]
    - @dexto/core@1.1.9

## 1.1.8

### Patch Changes

- Updated dependencies [d79d358]
    - @dexto/core@1.1.8

## 1.1.7

### Patch Changes

- @dexto/core@1.1.7

## 1.1.6

### Patch Changes

- @dexto/core@1.1.6

## 1.1.5

### Patch Changes

- 795c7f1: feat: Add @dexto/client-sdk package
    - New lightweight cross-environment client SDK
    - HTTP + optional WebSocket support for messaging
    - Streaming and non-streaming message support
    - Session management, LLM config/catalog access
    - MCP tools integration and search functionality
    - Real-time events support
    - Comprehensive TypeScript types and validation
    - Unit tests and documentation included

- 09b8e33: Fix minor comments
- Updated dependencies [e2bd0ce]
- Updated dependencies [11cbec0]
- Updated dependencies [795c7f1]
- Updated dependencies [9d7541c]
    - @dexto/core@1.1.5
