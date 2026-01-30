# @dexto/server

## 1.5.7

### Patch Changes

- 7de0cbe: Add Dexto authentication and gateway provider support

    **Feature Flag**: `DEXTO_FEATURE_AUTH=true` (default OFF for gradual rollout)

    ### New CLI Commands
    - `dexto login` - OAuth browser login or `--api-key` for CI/automation
    - `dexto logout` - Clear stored credentials
    - `dexto auth status` - Show current auth state
    - `dexto billing` - View credit balance and usage

    ### New Provider: `dexto`
    - Gateway provider routing requests through Dexto API
    - Supports all OpenRouter models via `supportsAllRegistryModels` flag
    - Curated model list shown during setup (mix of free and SOTA models)
    - New users receive $5 credits on first login

    ### Model Registry Enhancements
    - Added `openrouterId` field to map native model names to OpenRouter format
    - Model transformation in LLM resolver for gateway providers
    - New `/llm/capabilities` API for accurate capability checking across providers

    ### Sub-Agent Support
    - LLM preferences now apply to ALL agents, not just default
    - `modelLocked` feature for agents requiring specific models (e.g., explore-agent)
    - Sub-agent resolution inherits parent LLM config including baseURL

    ### Web UI
    - Settings panel for managing Dexto API keys
    - Model picker updated with Dexto provider support
    - "via Dexto" visual indicator when using gateway

    ### Security
    - CSRF state validation in OAuth flow
    - 10s timeouts on all Supabase auth fetch calls
    - Secure credential storage in `~/.dexto/auth.json`

- c4ae9e7: Added support for skills and plugins. Create a custom plugin for plan tools and skills along with support for Plan mode.
- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [eb71ec9]
- Updated dependencies [1960235]
    - @dexto/agent-management@1.5.7
    - @dexto/core@1.5.7
    - @dexto/image-local@1.5.7

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
    - @dexto/image-local@1.5.6
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- Updated dependencies [9ab3eac]
- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/image-local@1.5.5
    - @dexto/core@1.5.5
    - @dexto/agent-management@1.5.5

## 1.5.4

### Patch Changes

- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4
    - @dexto/agent-management@1.5.4
    - @dexto/image-local@1.5.4

## 1.5.3

### Patch Changes

- 69c944c: File integrity & performance improvements, approval system fixes, and developer experience enhancements

    ### File System Improvements
    - **File integrity protection**: Store file hashes to prevent edits from corrupting files when content changes between operations (resolves #516)
    - **Performance optimization**: Disable backups and remove redundant reads, switch to async non-blocking reads for faster file writes

    ### Approval System Fixes
    - **Coding agent auto-approve**: Fix auto-approve not working due to incorrect tool names in auto-approve policies
    - **Parallel tool calls**: Fix multiple parallel same-tool calls requiring redundant approvals - now checks all waiting approvals and resolves ones affected by newly approved commands
    - **Refactored CLI approval handler**: Decoupled approval handler pattern from server for better separation of concerns

    ### Shell & Scripting Fixes
    - **Bash mode aliases**: Fix bash mode not honoring zsh aliases
    - **Script improvements**: Miscellaneous script improvements for better developer experience

- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/agent-management@1.5.3
    - @dexto/image-local@1.5.3
    - @dexto/core@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [91acb03]
- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/agent-management@1.5.2
    - @dexto/core@1.5.2
    - @dexto/image-local@1.5.2

## 1.5.1

### Patch Changes

- bfcc7b1: PostgreSQL improvements and privacy mode

    **PostgreSQL enhancements:**
    - Add connection resilience for serverless databases (Neon, Supabase, etc.) with automatic retry on connection failures
    - Support custom PostgreSQL schemas via `options.schema` config
    - Add schema name validation to prevent SQL injection
    - Improve connection pool error handling to prevent process crashes

    **Privacy mode:**
    - Add `--privacy-mode` CLI flag to hide file paths from output (useful for screen recording/sharing)
    - Can also be enabled via `DEXTO_PRIVACY_MODE=true` environment variable

    **Session improvements:**
    - Add message deduplication in history provider to handle data corruption gracefully
    - Add warning when conversation history hits 10k message limit
    - Improve session deletion to ensure messages are always cleaned up

    **Other fixes:**
    - Sanitize explicit `agentId` for filesystem safety
    - Change verbose flush logs to debug level
    - Export `BaseTypedEventEmitter` from events module

- Updated dependencies [a25d3ee]
- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/agent-management@1.5.1
    - @dexto/core@1.5.1
    - @dexto/image-local@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- ee12727: Added support for node-llama (llama.cpp) for local GGUF models. Added Ollama as first-class provider. Updated onboarding/setup flow.
- 1e7e974: Added image bundler, @dexto/image-local and moved tool services outside core. Added registry providers to select core services.
- 4c05310: Improve local model/GGUF model support, bash permission fixes in TUI, and add local/ollama switching/deleting support in web UI
- 5fa79fa: Renamed compression to compaction, added context-awareness to hono, updated cli tool display formatting and added integration test for image-local.
- 263fcc6: Add disableAuth parameter for custom auth layers
- ef40e60: Upgrades package versions and related changes to MCP SDK. CLI colors improved and token streaming added to status bar.

    Security: Resolve all Dependabot security vulnerabilities. Updated @modelcontextprotocol/sdk to 1.25.2, esbuild to 0.25.0, langchain to 0.3.37, and @langchain/core to 0.3.80. Added pnpm overrides for indirect vulnerabilities (preact@10.27.3, qs@6.14.1, jws@3.2.3, mdast-util-to-hast@13.2.1). Fixed type errors from MCP SDK breaking changes.

- 7d5ab19: Updated WebUI design, event and state management and forms
- 436a900: Add support for openrouter, bedrock, glama, vertex ai, fix model switching issues and new model experience for each
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
    - @dexto/image-local@1.5.0

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating

### Patch Changes

- 7a64414: Updated agent-management to use AgentManager instead of AgentOrchestrator.
- 3cdce89: Revamp CLI for coding agent, add new events, improve mcp management, custom models, minor UI changes, prompt management
- d640e40: Remove LLM services, tokenizers, just stick with vercel, remove 'router' from schema and all types and docs
- 6f5627d: - Approval timeouts are now optional, defaulting to no timeout (infinite wait)
    - Tool call history now includes success/failure status tracking
- c54760f: Revamp context management layer - add partial stream cancellation, message queueing, context compression with LLM, MCP UI support and gaming agent. New APIs and UI changes for these things
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

### Minor Changes

- eb266af: Migrate WebUI from next-js to vite. Fix any typing in web UI. Improve types in core. minor renames in event schemas

### Patch Changes

- Updated dependencies [e2f770b]
- Updated dependencies [f843b62]
- Updated dependencies [eb266af]
    - @dexto/core@1.3.0
    - @dexto/agent-management@1.3.0

## 1.2.6

### Patch Changes

- 7feb030: Update memory and prompt configs, fix agent install bug
- Updated dependencies [7feb030]
    - @dexto/core@1.2.6
    - @dexto/agent-management@1.2.6

## 1.2.5

### Patch Changes

- c1e814f: ## Logger v2 & Config Enrichment

    ### New Features
    - **Multi-transport logging system**: Configure console, file, and remote logging transports via `logger` field in agent.yml. Supports log levels (error, warn, info, debug, silly) and automatic log rotation for file transports.
    - **Per-agent isolation**: CLI automatically creates per-agent log files at `~/.dexto/logs/<agent-id>.log`, database at `~/.dexto/database/<agent-id>.db`, and blob storage at `~/.dexto/blobs/<agent-id>/`
    - **Agent ID derivation**: Agent ID is now automatically derived from `agentCard.name` (sanitized) or config filename, enabling proper multi-agent isolation without manual configuration

    ### Breaking Changes
    - **Storage blob default changed**: Default blob storage type changed from `local` to `in-memory`. Existing configs with explicit `blob: { type: 'local' }` are unaffected. CLI enrichment provides automatic paths for SQLite and local blob storage.

    ### Improvements
    - **Config enrichment layer**: New `enrichAgentConfig()` in agent-management package adds per-agent paths before initialization, eliminating path resolution in core services
    - **Logger error factory**: Added typed error factory pattern for logger errors following project conventions
    - **Removed wildcard exports**: Logger module now uses explicit named exports for better tree-shaking

    ### Documentation
    - Added complete logger configuration section to agent.yml documentation
    - Documented agentId field and derivation rules
    - Updated storage documentation with CLI auto-configuration notes
    - Added logger v2 architecture notes to core README

- f9bca72: Add changeset for dropping defaultSessions from core layers.
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

- cc49f06: Added comprehensive support for A2A protocol
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

- 5a26bdf: Update hono server to chain apis to keep type info, update client sdk to be fully typed
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
