# dexto

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
    - @dexto/agent-management@1.6.0
    - @dexto/agent-config@1.6.0
    - @dexto/core@1.6.0
    - @dexto/image-logger-agent@1.6.0
    - @dexto/image-local@1.6.0
    - @dexto/analytics@1.6.0
    - @dexto/registry@1.6.0
    - @dexto/storage@1.6.0
    - @dexto/server@1.6.0

## 1.5.8

### Patch Changes

- 8687817: Add granular control for tools. /tools now allows you to view and update the following settings:
    - Enable/disable tools by scope (session/global)
    - Auto-approve tools for session (global scope updates can be added if required)
- fc77b59: - Replace the hardcoded LLM registry with a `models.dev`-synced snapshot, manual overlays, and a Node-only cached auto-update path.
    - Enforce gateway providers (e.g. `dexto`, `openrouter`) use OpenRouter-format model IDs (`vendor/model`) and improve model capability filtering.
    - Improve model selection UX in CLI and Web UI (curated lists by default, clearer post-setup path for custom model IDs).
    - Tighten server LLM route query validation and keep OpenAPI docs in sync.
- 9417803: Updated setup flow for OpenRouter with option to set maxInput tokens. Enabled /model to allow setting default model. Added toggle for auto-reading AGENTS.MD or other instructions file via `agentFile` param in config.
- ef90f6f: - Fix resource path display and suggestion logic in CLI to correctly handle filesystem URIs.
    - Refine resource references to prioritize project-relative paths (e.g., `@src/main.ts`) over filenames to avoid ambiguity.
    - Improve resource discoverability by implementing directory exclusions (`node_modules`, `.git`, `.turbo`, etc.) in `FileSystemResourceHandler`.
    - Refine exclusion logic to ensure project files with names similar to ignored directories are not incorrectly skipped.
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
    - @dexto/agent-management@1.5.8
    - @dexto/core@1.5.8
    - @dexto/server@1.5.8
    - @dexto/analytics@1.5.8
    - @dexto/image-local@1.5.8
    - @dexto/registry@1.5.8

## 1.5.7

### Patch Changes

- 43aaa9b: Implement useGitBranch hook to retrieve current git branch name and integrate it into AlternateBufferCLI and StaticCLI components.
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
- ee3f1f8: Added support for OAuth 2.1 flow for MCP connections. Updated search_files tool logic for file type. Added new Swiggy mcp servers to registry.
- 2e27f98: Align readme languages options
- eb71ec9: Updated LLM fallback handling in subagent spawn tool. Spawn tool now checks for any LLM-errors and falls back to parent's active runtime config - accounts for model switching during session runtime.
- 1960235: Add GLM and Minimax to Dexto gateway and onboarding. Split agent logging per session. Persist /model overrides per session. Other bug fixes for message filtering.
- 3fa6851: Update README for all languages
- 9bb41b4: Fix Escape key getting stuck during tool approval prompts. Previously, pressing Escape while a tool approval was showing would trigger the global "Interrupted" message but leave the approval UI visible and the tool stuck in "Waiting..." state. Now Escape properly cancels the approval and finalizes the tool with a "Cancelled" status.
- 1357b2c: Harden dexto auth enabled checks.
- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [eb71ec9]
- Updated dependencies [1960235]
    - @dexto/agent-management@1.5.7
    - @dexto/server@1.5.7
    - @dexto/core@1.5.7
    - @dexto/image-local@1.5.7
    - @dexto/analytics@1.5.7
    - @dexto/registry@1.5.7

## 1.5.6

### Patch Changes

- b805d2a: Add support for package version check and prompt user to update. Added `sync-agents` command and auto-prompt on startup for user to update agent configs. Updated docs for installation and ink-cli slash commands.
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
    - @dexto/analytics@1.5.6
    - @dexto/registry@1.5.6
    - @dexto/server@1.5.6
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- 9ab3eac: Added todo tools.
- 63fa083: Session and context management fixes:
    - Remove continuation session logic after compaction, now sticks to same session
    - `/clear` continues same session and resets context (frees up AI context window)
    - `/new` command creates new session with fresh context and clears screen
    - Add context tokens remaining to footer, align context calculations everywhere
    - Fix context calculation logic by including cache read tokens

    Other improvements:
    - Fix code block syntax highlighting in terminal (uses cli-highlight)
    - Make terminal the default mode during onboarding
    - Reduce OTEL dependency bloat by replacing auto-instrumentation with specific packages (47 MB saved: 65 MB → 18 MB)

- 6df3ca9: Updated readme. Removed stale filesystem and process tool from dexto/core.
- Updated dependencies [9ab3eac]
- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/image-local@1.5.5
    - @dexto/core@1.5.5
    - @dexto/registry@1.5.5
    - @dexto/server@1.5.5
    - @dexto/agent-management@1.5.5
    - @dexto/analytics@1.5.5

## 1.5.4

### Patch Changes

- 0016cd3: Bug fixes and updates for compaction. Also added UI enhancements for compaction.
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
    - @dexto/analytics@1.5.4
    - @dexto/agent-management@1.5.4
    - @dexto/image-local@1.5.4
    - @dexto/server@1.5.4
    - @dexto/registry@1.5.4

## 1.5.3

### Patch Changes

- 4f00295: Added spawn-agent tools and explore agent.
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
    - @dexto/server@1.5.3
    - @dexto/analytics@1.5.3
    - @dexto/registry@1.5.3

## 1.5.2

### Patch Changes

- 8a85ea4: Fix maxsteps in agent loop causing early termination
- 527f3f9: Fixes for interactive CLI
- Updated dependencies [91acb03]
- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/agent-management@1.5.2
    - @dexto/core@1.5.2
    - @dexto/analytics@1.5.2
    - @dexto/server@1.5.2
    - @dexto/image-local@1.5.2
    - @dexto/registry@1.5.2

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
- Updated dependencies [a25d3ee]
- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/agent-management@1.5.1
    - @dexto/core@1.5.1
    - @dexto/server@1.5.1
    - @dexto/analytics@1.5.1
    - @dexto/image-local@1.5.1
    - @dexto/registry@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- abfe5ce: Update and standardize analytics for CLI and web UI
- ee12727: Added support for node-llama (llama.cpp) for local GGUF models. Added Ollama as first-class provider. Updated onboarding/setup flow.
- 1e7e974: Added image bundler, @dexto/image-local and moved tool services outside core. Added registry providers to select core services.
- 4c05310: Improve local model/GGUF model support, bash permission fixes in TUI, and add local/ollama switching/deleting support in web UI
- 5fa79fa: Renamed compression to compaction, added context-awareness to hono, updated cli tool display formatting and added integration test for image-local.
- ef40e60: Upgrades package versions and related changes to MCP SDK. CLI colors improved and token streaming added to status bar.

    Security: Resolve all Dependabot security vulnerabilities. Updated @modelcontextprotocol/sdk to 1.25.2, esbuild to 0.25.0, langchain to 0.3.37, and @langchain/core to 0.3.80. Added pnpm overrides for indirect vulnerabilities (preact@10.27.3, qs@6.14.1, jws@3.2.3, mdast-util-to-hast@13.2.1). Fixed type errors from MCP SDK breaking changes.

- 436a900: Add support for openrouter, bedrock, glama, vertex ai, fix model switching issues and new model experience for each
- Updated dependencies [abfe5ce]
- Updated dependencies [ee12727]
- Updated dependencies [1e7e974]
- Updated dependencies [4c05310]
- Updated dependencies [5fa79fa]
- Updated dependencies [263fcc6]
- Updated dependencies [ef40e60]
- Updated dependencies [e714418]
- Updated dependencies [e7722e5]
- Updated dependencies [7d5ab19]
- Updated dependencies [436a900]
    - @dexto/analytics@1.5.0
    - @dexto/agent-management@1.5.0
    - @dexto/server@1.5.0
    - @dexto/core@1.5.0
    - @dexto/image-local@1.5.0
    - @dexto/registry@1.5.0

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating

### Patch Changes

- a293c1a: Moved discord and telegram from CLI to examples.
- 7a64414: Updated agent-management to use AgentManager instead of AgentOrchestrator.
- 3cdce89: Revamp CLI for coding agent, add new events, improve mcp management, custom models, minor UI changes, prompt management
- d640e40: Remove LLM services, tokenizers, just stick with vercel, remove 'router' from schema and all types and docs
- 6f5627d: - Approval timeouts are now optional, defaulting to no timeout (infinite wait)
    - Tool call history now includes success/failure status tracking
- 6e6a3e7: Fix message typings to use proper discriminated unions in core and webui
- c54760f: Revamp context management layer - add partial stream cancellation, message queueing, context compression with LLM, MCP UI support and gaming agent. New APIs and UI changes for these things
- 3b4b919: Fixed Ink CLI bugs and updated state management system.
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
    - @dexto/server@1.4.0
    - @dexto/registry@1.4.0
    - @dexto/analytics@1.4.0

## 1.3.0

### Minor Changes

- eb266af: Migrate WebUI from next-js to vite. Fix any typing in web UI. Improve types in core. minor renames in event schemas

### Patch Changes

- e2f770b: Add changeset for updated schema defaults and updated docs.
- 306f5de: Fix cursor navigation in CLI input. Users can now use left/right arrow keys, Home/End keys to navigate within the input text. Fixed by replacing CustomInput with CustomTextInput which uses ink-text-input with built-in cursor support.
- 6886db4: Add workflow builder/n8n agent and product analysis/posthog agent
- 66ce8c2: Added changeset for ink-cli upgrades and metadata patch in webui
- f843b62: Change otel and storage deps to peer dependencies with dynamic imports to reduce bloat
- Updated dependencies [e2f770b]
- Updated dependencies [f843b62]
- Updated dependencies [eb266af]
    - @dexto/core@1.3.0
    - @dexto/server@1.3.0
    - @dexto/agent-management@1.3.0
    - @dexto/analytics@1.3.0

## 1.2.6

### Patch Changes

- 7feb030: Update memory and prompt configs, fix agent install bug
- Updated dependencies [7feb030]
    - @dexto/server@1.2.6
    - @dexto/core@1.2.6
    - @dexto/agent-management@1.2.6
    - @dexto/analytics@1.2.6

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
- c0a10cd: Add changeset for mcp http mode patches.
- 81598b5: Decoupled elicitation from tool confirmation. Added `DenialReason` enum and structured error messages to approval responses.
    - Tool approvals and elicitation now independently configurable via `elicitation.enabled` config
    - Approval errors include `reason` (user_denied, timeout, system_denied, etc.) and `message` fields
    - Enables `auto-approve` for tools while preserving interactive elicitation

    Config files without the new `elicitation` section will use defaults. No legacy code paths.

- 1a20506: update source context usage to also go through preferences + registry flow. added dexto_dev_mode flag for maintainers
- 7bca27d: Added changeset for new react ink based CLI.
- 8f373cc: Migrate server API to Hono framework with feature flag
    - Migrated Express server to Hono with OpenAPI schema generation
    - Added DEXTO_USE_HONO environment variable flag (default: false for backward compatibility)
    - Fixed WebSocket test isolation by adding sessionId filtering
    - Fixed logger context to pass structured objects instead of stringified JSON
    - Fixed CI workflow for OpenAPI docs synchronization
    - Updated documentation links and fixed broken API references

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
- Updated dependencies [cc49f06]
- Updated dependencies [a154ae0]
- Updated dependencies [5a26bdf]
- Updated dependencies [ac649fd]
    - @dexto/agent-management@1.2.5
    - @dexto/server@1.2.5
    - @dexto/core@1.2.5
    - @dexto/analytics@1.2.5

## 1.2.4

### Patch Changes

- cd706e7: bump up version after fixing node-machine-id
- Updated dependencies [cd706e7]
    - @dexto/analytics@1.2.4
    - @dexto/core@1.2.4

## 1.2.3

### Patch Changes

- 5d6ae73: Bump up version to fix bugs
- Updated dependencies [5d6ae73]
    - @dexto/analytics@1.2.3
    - @dexto/core@1.2.3

## 1.2.2

### Patch Changes

- 8b96b63: Add posthog analytics package and add to web ui
- Updated dependencies [8b96b63]
    - @dexto/analytics@1.2.2
    - @dexto/core@1.2.2

## 1.2.1

### Patch Changes

- 9a26447: Fix starter prompts
    - @dexto/core@1.2.1

## 1.2.0

### Minor Changes

- 1e25f91: Update web UI to be default, fix port bugs, update docs

### Patch Changes

- 4a191d2: Update agents
- a27ddf0: Add OTEL telemetry to trace agent execution
- 3a65cde: Update older LLMs to new LLMs, update docs
- 5ba5d38: **Features:**
    - Agent switcher now supports file-based agents loaded via CLI (e.g., `dexto --agent path/to/agent.yml`)
    - Agent selector UI remembers recent agents (up to 5) with localStorage persistence
    - WebUI displays currently active file-based agent and recent agent history
    - Dev server (`pnpm dev`) now auto-opens browser when WebUI is ready
    - Added `/test-api` custom command for automated API test coverage analysis

    **Bug Fixes:**
    - Fixed critical bug where Memory, A2A, and MCP API routes used stale agent references after switching
    - Fixed telemetry shutdown blocking agent switches when observability infrastructure (Jaeger/OTLP) is unavailable
    - Fixed dark mode styling issues when Chrome's Auto Dark Mode is enabled
    - Fixed agent card not updating for A2A and MCP routes after agent switch

    **Improvements:**
    - Refactored `Dexto.createAgent()` to static method, removing unnecessary singleton pattern
    - Improved error handling for agent switching with typed errors (CONFLICT error type, `AgentError.switchInProgress()`)
    - Telemetry now disabled by default (opt-in) in default agent configuration
    - Added localStorage corruption recovery for recent agents list

- c6594d9: Add changeset for updated readme and docs.
- 3f99854: Update docs, update agents to use newer LLMs, update readmes
- 930a4ca: Fixes in UI, docs and agents
- 2940fbf: Add changeset for playground ui updates
- 930d75a: Add mcp server restart feature and button in webUI
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

- c40b675: - Updated toolResult sanitization flow
    - Added support for video rendering to WebUI
- 015100c: Added new memory manager for creating, storing and managing memories.
    - FileContributor has a new memories contributor for loading memories into SystemPrompt.
- 2b81734: Updated WebUI for MCP connection flow and other minor updates
- 5cc6933: Fixes for prompts/resource management, UI improvements, custom slash command support, add support for embedded/linked resources, proper argument handling for prompts
- 40f89f5: Add New Agent buttons, form editor, new APIs, Dexto class
- 3a24d08: Add claude haiku 4.5 support
- 0558564: Several enhancement have been made to the WebUI to improve UI/UX
    - Minor fixes to styling for AgentSelector and MCP Registry
    - Sessions Panel updated UI & list ordering
    - Sessions Panel updated page routing
- 01167a2: Refactors
- a53b87a: feat: Redesign agent registry system with improved agent switching
    - **@dexto/core**: Enhanced agent registry with better ID-based resolution, improved error handling, and normalized registry entries
    - **dexto**: Added agent switching capabilities via API with proper state management
    - **@dexto/webui**: Updated agent selector UI with better UX for switching between agents
    - Agent resolution now uses `agentId` instead of `agentName` throughout the system
    - Registry entries now require explicit `id` field matching the registry key

- 24e5093: Add customize agent capabilities
- c695e57: Add blob storage system for persistent binary data management:
    - Implement blob storage backend with local filesystem support
    - Add blob:// URI scheme for referencing stored blobs
    - Integrate blob storage with resource system for seamless @resource references
    - Add automatic blob expansion in chat history and message references
    - Add real-time cache invalidation events for resources and prompts
    - Fix prompt cache invalidation WebSocket event handling in WebUI
    - Add robustness improvements: empty text validation after resource expansion and graceful blob expansion error handling
    - Support image/file uploads with automatic blob storage
    - Add WebUI components for blob resource display and autocomplete
- 0a5636c: Added a new Approval System and support MCP Elicitations
- 35d48c5: Add chat summary generation
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

- 0f4d181: Add skip setup flag
    - @dexto/core@1.1.10

## 1.1.9

### Patch Changes

- 27778ba: Add claude 4.5 sonnet and make it default
- Updated dependencies [27778ba]
    - @dexto/core@1.1.9

## 1.1.8

### Patch Changes

- 35d82cc: Add github agent and update registry
- d79d358: Add agent toggle functionality to webui
- d79d358: Add new functions for agent management to DextoAgent()
- Updated dependencies [d79d358]
    - @dexto/core@1.1.8

## 1.1.7

### Patch Changes

- 4216e79: Add auto approve flag
    - @dexto/core@1.1.7

## 1.1.6

### Patch Changes

- e6d029c: Update logos and fix build
    - @dexto/core@1.1.6

## 1.1.5

### Patch Changes

- 11cbec0: Update READMEs and docs
- dca7985: Simplify CLI session management with -c/-r flags and streamlined session commands
    - Add -c/--continue flag to resume most recent session
    - Add -r/--resume <sessionId> flag to resume specific session
    - Remove redundant session commands (new, switch, current)
    - Update default behavior to create new sessions
    - Simplify help text and command descriptions

- 9d7541c: Add posthog telemetry
- Updated dependencies [e2bd0ce]
- Updated dependencies [11cbec0]
- Updated dependencies [795c7f1]
- Updated dependencies [9d7541c]
    - @dexto/core@1.1.5

## 1.1.4

### Patch Changes

- de49328: Update dependencies
- 2fccffd: Migrating to monorepo
- Updated dependencies [2fccffd]
    - @dexto/core@1.1.4
