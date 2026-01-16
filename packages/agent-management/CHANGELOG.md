# @dexto/agent-management

## 1.5.2

### Patch Changes

- 91acb03: Fix typo in agents.md detection
- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/core@1.5.2

## 1.5.1

### Patch Changes

- a25d3ee: Add shell command execution (`!command` shortcut), token counting display, and auto-discovery of agent instruction files (agent.md, claude.md, gemini.md)
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

- 4aabdb7: Fix claude caching, added gpt-5.2 models and reasoning effort options in user flows.
- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/core@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- ee12727: Added support for node-llama (llama.cpp) for local GGUF models. Added Ollama as first-class provider. Updated onboarding/setup flow.
- 4c05310: Improve local model/GGUF model support, bash permission fixes in TUI, and add local/ollama switching/deleting support in web UI
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
    - @dexto/core@1.5.0

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating

### Patch Changes

- 7a64414: Updated agent-management to use AgentManager instead of AgentOrchestrator.
- 3cdce89: Revamp CLI for coding agent, add new events, improve mcp management, custom models, minor UI changes, prompt management
- d640e40: Remove LLM services, tokenizers, just stick with vercel, remove 'router' from schema and all types and docs
- c54760f: Revamp context management layer - add partial stream cancellation, message queueing, context compression with LLM, MCP UI support and gaming agent. New APIs and UI changes for these things
- Updated dependencies [bd5c097]
- Updated dependencies [3cdce89]
- Updated dependencies [d640e40]
- Updated dependencies [6f5627d]
- Updated dependencies [6e6a3e7]
- Updated dependencies [f73a519]
- Updated dependencies [c54760f]
- Updated dependencies [ab47df8]
- Updated dependencies [3b4b919]
    - @dexto/core@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies [e2f770b]
- Updated dependencies [f843b62]
- Updated dependencies [eb266af]
    - @dexto/core@1.3.0

## 1.2.6

### Patch Changes

- Updated dependencies [7feb030]
    - @dexto/core@1.2.6

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
    - @dexto/core@1.2.5
