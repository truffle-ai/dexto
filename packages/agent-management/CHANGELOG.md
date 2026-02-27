# @dexto/agent-management

## 1.6.6

### Patch Changes

- 7e2bcd2: fix windows escape sequence
- Updated dependencies [7e2bcd2]
    - @dexto/agent-config@1.6.6
    - @dexto/core@1.6.6
    - @dexto/orchestration@1.6.6
    - @dexto/tools-builtins@1.6.6

## 1.6.5

### Patch Changes

- 60aab0e: Fix windows build for binary distribution
- 19a4983: Update scripts to remove single quotes for windows compat
- Updated dependencies [60aab0e]
- Updated dependencies [19a4983]
    - @dexto/agent-config@1.6.5
    - @dexto/core@1.6.5
    - @dexto/orchestration@1.6.5
    - @dexto/tools-builtins@1.6.5

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution
- Updated dependencies [7cb9082]
    - @dexto/agent-config@1.6.4
    - @dexto/core@1.6.4
    - @dexto/orchestration@1.6.4
    - @dexto/tools-builtins@1.6.4

## 1.6.3

### Patch Changes

- @dexto/core@1.6.3
- @dexto/agent-config@1.6.3
- @dexto/tools-builtins@1.6.3
- @dexto/orchestration@1.6.3

## 1.6.2

### Patch Changes

- 5e6383d: Add reasoning presets + reasoning trace controls across CLI/WebUI:
    - Introduce structured reasoning config (preset + optional budget tokens) with provider-aware reasoning presets (`off|low|medium|high|max|xhigh`) and validate availability via the LLM registry (including the dynamic OpenRouter catalog).
    - Map presets to provider-native knobs (e.g. OpenAI `reasoningEffort`, budget-token models) and reuse the same behavior across gateways (OpenRouter / Dexto Nova / native).
    - Rename “reasoning effort” terminology to “reasoning preset” throughout the UX.
    - CLI: Tab cycles the active reasoning preset; reasoning traces can be displayed in the transcript.
    - Add `/reasoning` overlay to toggle reasoning trace visibility and (when supported) set/clear budget tokens.
    - Enable Claude interleaved thinking for Claude 4+ models and align gateway/provider request headers so reasoning tuning behaves consistently (OpenRouter / Dexto Nova / native).
    - Improve `/model` to surface all gateway models (OpenRouter/Dexto Nova) and their reasoning capability metadata.
    - Default spawned sub-agents to reduced/no reasoning to avoid long-running spawned tasks.

- 7b2c395: Added skill creation and management tools.
- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/core@1.6.2
    - @dexto/tools-builtins@1.6.2
    - @dexto/agent-config@1.6.2
    - @dexto/orchestration@1.6.2

## 1.6.1

### Patch Changes

- 03d4564: consolidates scheduler runtime changes and workspace context propagation, and ensures sub‑agents inherit the parent workspace.
- 526d906: - Add a `/sounds` overlay to preview and select notification sounds (startup/approval/completion), including custom files from `~/.dexto/sounds/`.
    - Play an optional startup sound when the interactive CLI launches.
    - Add preferences to select per-event sound files via paths relative to `~/.dexto/sounds` (`sounds.*SoundFile`).
- 112dadf: - CLI/TUI: cleaner overlays (selectors, approvals, elicitation) with consistent sizing to reduce flicker on small terminals.
    - Tools: richer pre-approval previews (files/diffs, bash commands, plans) and clearer tool output formatting in message history.
    - Filesystem approvals: directory access checks now handle symlinks/realpaths consistently so approved directories actually work (e.g. `/tmp` on macOS).
    - ask_user: wizard-style elicitation flow with a deterministic schema contract (field `title`/`description` + `x-dexto.stepLabel`).
    - Reliability & build: deterministic `http_request` tests (no network) and faster builds by separating JS bundling from DTS generation.
- Updated dependencies [03d4564]
- Updated dependencies [112dadf]
    - @dexto/core@1.6.1
    - @dexto/tools-builtins@1.6.1
    - @dexto/orchestration@1.6.1
    - @dexto/agent-config@1.6.1

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

- d6b4368: Tool type-safety + validation improvements
    - Preserve Zod-derived input types through `defineTool()`/`Tool<TSchema>` so tool factories expose typed `execute()` inputs to callers.
    - Centralize local tool arg validation in ToolManager (and re-validate after hook mutation) so tools always receive schema-validated args and defaults/coercions are consistently applied.
    - Refactor filesystem tool directory-access approvals to share a single helper and keep approval/execution path resolution consistent.
    - Small UX/consistency fixes across plan/process/orchestration tools and the CLI config summary output.

- 99cf1c6: Refactors
    - Agent config terminology updates:
        - `toolConfirmation` → `permissions`
        - `internalResources` → `resources` (and removes the unused `enabled` flag)
        - runtime “plugins” → “hooks” (to avoid confusion with Claude Code-style plugins)
    - CLI UX: removes headless/positional prompt mode; `--prompt` now starts the interactive CLI with an initial prompt.
    - CLI UX: the “Agent config updates available” sync prompt reappears on subsequent runs until agents are synced (no per-version dismissal).
    - Tool surface refactor: removes `custom`/`internal` tool ID prefixes; MCP tools remain namespaced.
    - Approval UX:
        - Directory access prompts now auto-approve parallel pending requests after the first approval (reduces repetitive prompts during multi-tool flows).
        - Remembering a tool for the session now auto-approves parallel pending tool approvals for that tool.
    - New and updated tools:
        - Adds built-in Exa `web_search` + `code_search` tools.
        - Enables built-in `http_request` (“Fetch”) in the default and coding agents.
        - Refines tool display names for readability (e.g. “Update Todos”, “Web Search”, “Code Search”, “Check Task”, “List Tasks”).
        - Adds `@dexto/tools-lifecycle` (view logs + memory management) and moves session search into lifecycle tools.
    - UI terminology: “task list” → “todo list”.
    - Images:
        - `DextoImageModule` renamed to `DextoImage`.
        - `dexto image create` scaffold includes minimal examples for tools/hooks/storage/compaction.
- Updated dependencies [d6b4368]
- Updated dependencies [facabe1]
- Updated dependencies [99cf1c6]
- Updated dependencies [c862605]
- Updated dependencies [8d37b8a]
- Updated dependencies [7ffa399]
    - @dexto/tools-builtins@1.6.0
    - @dexto/orchestration@1.6.0
    - @dexto/agent-config@1.6.0
    - @dexto/core@1.6.0

## 1.5.8

### Patch Changes

- 8687817: Add granular control for tools. /tools now allows you to view and update the following settings:
    - Enable/disable tools by scope (session/global)
    - Auto-approve tools for session (global scope updates can be added if required)
- 9417803: Updated setup flow for OpenRouter with option to set maxInput tokens. Enabled /model to allow setting default model. Added toggle for auto-reading AGENTS.MD or other instructions file via `agentFile` param in config.
- 5618ac1: Added DEXTO_BACKGROUND_TASKS_ENABLED with default false to toggle bg task and async capabilities
- 20a2b91: Rename gateway provider from dexto to dexto-nova and other relevant updates. Updated setup flow to include credit buying options along with `dexto billing --buy` flag option.
- c49bc44: Introduced multi-task orchestration with background task tools, signals, and CLI panels; improved background task summaries/logging and cancellation handling; tightened LLM override persistence/restore safeguards; and migrated LLM execution to the Responses API.
- Updated dependencies [8687817]
- Updated dependencies [fc77b59]
- Updated dependencies [9417803]
- Updated dependencies [5618ac1]
- Updated dependencies [ef90f6f]
- Updated dependencies [20a2b91]
- Updated dependencies [9990e4f]
- Updated dependencies [c49bc44]
    - @dexto/core@1.5.8
    - @dexto/orchestration@1.5.8

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
- a2c7092: Fix command discovery, update skills permissions, and rewrite AGENTS.md

    **AGENTS.md:**
    - Fix outdated stack info: WebUI is Vite + TanStack Router/Query (not Next.js)
    - Fix API layer location: Hono routes in packages/server (not packages/cli/src/api)
    - Add Stack Rules section (WebUI/Server/Core constraints)
    - Add Avoiding Duplication section (search before adding utilities)
    - Update Zod conventions: z.input/z.output instead of z.infer
    - Remove verbose code examples and outdated architecture diagrams

    **Slash commands/skills:**
    - Restore .claude/commands/ and .cursor/commands/ discovery paths
    - Change `allowed-tools` to additive semantics (auto-approve listed tools, don't block others)
    - Reset session auto-approve tools on `run:complete` event
    - Add tests for command discovery and permissions

    **Other:**
    - Skip changeset requirement for Dependabot PRs

- 1e0ac05: Added first class support for GLM and Minimax providers. Also updated setup flow with better config syncing prompts. Improved API key handling during `dexto setup` flow when switching default models.
- eb71ec9: Updated LLM fallback handling in subagent spawn tool. Spawn tool now checks for any LLM-errors and falls back to parent's active runtime config - accounts for model switching during session runtime.
- 1960235: Add GLM and Minimax to Dexto gateway and onboarding. Split agent logging per session. Persist /model overrides per session. Other bug fixes for message filtering.
- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [1960235]
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
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/core@1.5.5

## 1.5.4

### Patch Changes

- aa2c9a0: - new --dev flag for using dev mode with the CLI (for maintainers) (sets DEXTO_DEV_MODE=true and ensures local files are used)
    - improved bash tool descriptions
    - fixed explore agent task description getting truncated
    - fixed some alignment issues
    - fix search/find tools not asking approval for working outside directory
    - add sound feature (sounds when approval reqd, when loop done)
        - configurable in `preferences.yml` (on by default) and in `~/.dexto/sounds`, instructions in comment in `~/.dexto/preferences.yml`
    - add new `env` system prompt contributor that includes info about os, working directory, git status. useful for coding agent to get enough context to improve cmd construction without unnecessary directory shifts
    - support for loading `.claude/commands` and `.cursor/commands` global and local commands in addition to `.dexto/commands`
- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4

## 1.5.3

### Patch Changes

- 4f00295: Added spawn-agent tools and explore agent.
- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/core@1.5.3

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
