# @dexto/webui

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

- Updated dependencies [669f16e]
- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/analytics@1.6.2
    - @dexto/core@1.6.2
    - @dexto/agent-config@1.6.2
    - @dexto/client-sdk@1.6.2
    - @dexto/storage@1.6.2
    - @dexto/registry@1.6.2

## 1.6.1

### Patch Changes

- 03d4564: consolidates scheduler runtime changes and workspace context propagation, and ensures sub‑agents inherit the parent workspace.
- Updated dependencies [03d4564]
- Updated dependencies [112dadf]
    - @dexto/core@1.6.1
    - @dexto/agent-config@1.6.1
    - @dexto/client-sdk@1.6.1
    - @dexto/analytics@1.6.1
    - @dexto/registry@1.6.1
    - @dexto/storage@1.6.1

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
    - @dexto/agent-config@1.6.0
    - @dexto/core@1.6.0
    - @dexto/client-sdk@1.6.0
    - @dexto/analytics@1.6.0
    - @dexto/registry@1.6.0
    - @dexto/storage@1.6.0

## 1.5.8

### Patch Changes

- fc77b59: - Replace the hardcoded LLM registry with a `models.dev`-synced snapshot, manual overlays, and a Node-only cached auto-update path.
    - Enforce gateway providers (e.g. `dexto`, `openrouter`) use OpenRouter-format model IDs (`vendor/model`) and improve model capability filtering.
    - Improve model selection UX in CLI and Web UI (curated lists by default, clearer post-setup path for custom model IDs).
    - Tighten server LLM route query validation and keep OpenAPI docs in sync.
- 20a2b91: Rename gateway provider from dexto to dexto-nova and other relevant updates. Updated setup flow to include credit buying options along with `dexto billing --buy` flag option.
- Updated dependencies [8687817]
- Updated dependencies [fc77b59]
- Updated dependencies [9417803]
- Updated dependencies [5618ac1]
- Updated dependencies [ef90f6f]
- Updated dependencies [20a2b91]
- Updated dependencies [9990e4f]
- Updated dependencies [c49bc44]
    - @dexto/core@1.5.8
    - @dexto/analytics@1.5.8
    - @dexto/client-sdk@1.5.8
    - @dexto/registry@1.5.8

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
- 1e0ac05: Added first class support for GLM and Minimax providers. Also updated setup flow with better config syncing prompts. Improved API key handling during `dexto setup` flow when switching default models.
- Updated dependencies [7de0cbe]
- Updated dependencies [c4ae9e7]
- Updated dependencies [a2c7092]
- Updated dependencies [1e0ac05]
- Updated dependencies [ee3f1f8]
- Updated dependencies [1960235]
    - @dexto/core@1.5.7
    - @dexto/analytics@1.5.7
    - @dexto/client-sdk@1.5.7
    - @dexto/registry@1.5.7

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
    - @dexto/client-sdk@1.5.6
    - @dexto/analytics@1.5.6
    - @dexto/registry@1.5.6
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

- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/core@1.5.5
    - @dexto/registry@1.5.5
    - @dexto/analytics@1.5.5
    - @dexto/client-sdk@1.5.5

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
    - @dexto/analytics@1.5.4
    - @dexto/client-sdk@1.5.4
    - @dexto/registry@1.5.4

## 1.5.3

### Patch Changes

- 4f00295: Added spawn-agent tools and explore agent.
- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/core@1.5.3
    - @dexto/analytics@1.5.3
    - @dexto/client-sdk@1.5.3
    - @dexto/registry@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/core@1.5.2
    - @dexto/analytics@1.5.2
    - @dexto/client-sdk@1.5.2
    - @dexto/registry@1.5.2

## 1.5.1

### Patch Changes

- 4aabdb7: Fix claude caching, added gpt-5.2 models and reasoning effort options in user flows.
- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/core@1.5.1
    - @dexto/analytics@1.5.1
    - @dexto/client-sdk@1.5.1
    - @dexto/registry@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- abfe5ce: Update and standardize analytics for CLI and web UI
- ee12727: Added support for node-llama (llama.cpp) for local GGUF models. Added Ollama as first-class provider. Updated onboarding/setup flow.
- 4c05310: Improve local model/GGUF model support, bash permission fixes in TUI, and add local/ollama switching/deleting support in web UI
- 5fa79fa: Renamed compression to compaction, added context-awareness to hono, updated cli tool display formatting and added integration test for image-local.
- ef40e60: Upgrades package versions and related changes to MCP SDK. CLI colors improved and token streaming added to status bar.

    Security: Resolve all Dependabot security vulnerabilities. Updated @modelcontextprotocol/sdk to 1.25.2, esbuild to 0.25.0, langchain to 0.3.37, and @langchain/core to 0.3.80. Added pnpm overrides for indirect vulnerabilities (preact@10.27.3, qs@6.14.1, jws@3.2.3, mdast-util-to-hast@13.2.1). Fixed type errors from MCP SDK breaking changes.

- e714418: Added providers for db and cache storages. Expanded settings panel for API keys and other app preferences in WebUI along with other UI/UX enhancements.
- 7d5ab19: Updated WebUI design, event and state management and forms
- 436a900: Add support for openrouter, bedrock, glama, vertex ai, fix model switching issues and new model experience for each
- Updated dependencies [abfe5ce]
- Updated dependencies [ee12727]
- Updated dependencies [1e7e974]
- Updated dependencies [4c05310]
- Updated dependencies [5fa79fa]
- Updated dependencies [ef40e60]
- Updated dependencies [e714418]
- Updated dependencies [e7722e5]
- Updated dependencies [7d5ab19]
- Updated dependencies [436a900]
    - @dexto/analytics@1.5.0
    - @dexto/core@1.5.0
    - @dexto/client-sdk@1.5.0
    - @dexto/registry@1.5.0

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating

### Patch Changes

- bd5c097: Add features check for internal tools, fix coding agent and logger agent elicitation
- 3cdce89: Revamp CLI for coding agent, add new events, improve mcp management, custom models, minor UI changes, prompt management
- d640e40: Remove LLM services, tokenizers, just stick with vercel, remove 'router' from schema and all types and docs
- 6e6a3e7: Fix message typings to use proper discriminated unions in core and webui
- c54760f: Revamp context management layer - add partial stream cancellation, message queueing, context compression with LLM, MCP UI support and gaming agent. New APIs and UI changes for these things
- ab47df8: Add approval metadata and ui badge
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
    - @dexto/registry@1.4.0
    - @dexto/analytics@1.4.0
    - @dexto/client-sdk@1.4.0

## 1.3.0

### Minor Changes

- eb266af: Migrate WebUI from next-js to vite. Fix any typing in web UI. Improve types in core. minor renames in event schemas

### Patch Changes

- 215ae5b: Add new chat, search chats buttons, add rename, copy session ids, update UI to not have overlapping buttons for different layouts with session panel open
- 338da3f: Update model switcher UI
- 66ce8c2: Added changeset for ink-cli upgrades and metadata patch in webui
- Updated dependencies [e2f770b]
- Updated dependencies [f843b62]
- Updated dependencies [eb266af]
    - @dexto/core@1.3.0
    - @dexto/client-sdk@1.3.0
    - @dexto/analytics@1.3.0

## 1.2.6

### Patch Changes

- 7feb030: Update memory and prompt configs, fix agent install bug
- Updated dependencies [7feb030]
    - @dexto/core@1.2.6
    - @dexto/client-sdk@1.2.6
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

- 81598b5: Decoupled elicitation from tool confirmation. Added `DenialReason` enum and structured error messages to approval responses.
    - Tool approvals and elicitation now independently configurable via `elicitation.enabled` config
    - Approval errors include `reason` (user_denied, timeout, system_denied, etc.) and `message` fields
    - Enables `auto-approve` for tools while preserving interactive elicitation

    Config files without the new `elicitation` section will use defaults. No legacy code paths.

- 8f373cc: Migrate server API to Hono framework with feature flag
    - Migrated Express server to Hono with OpenAPI schema generation
    - Added DEXTO_USE_HONO environment variable flag (default: false for backward compatibility)
    - Fixed WebSocket test isolation by adding sessionId filtering
    - Fixed logger context to pass structured objects instead of stringified JSON
    - Fixed CI workflow for OpenAPI docs synchronization
    - Updated documentation links and fixed broken API references

- f28ad7e: Migrate webUI to use client-sdk, add agents.md file to webui,improve types in apis for consumption
- 4dd4998: Add changeset for command approval enhancement and orphaned tool handling
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
- Updated dependencies [5a26bdf]
- Updated dependencies [ac649fd]
    - @dexto/core@1.2.5
    - @dexto/client-sdk@1.2.5
    - @dexto/analytics@1.2.5

## 0.2.4

### Patch Changes

- cd706e7: bump up version after fixing node-machine-id
- Updated dependencies [cd706e7]
    - @dexto/analytics@1.2.4
    - @dexto/core@1.2.4

## 0.2.3

### Patch Changes

- 5d6ae73: Bump up version to fix bugs
- Updated dependencies [5d6ae73]
    - @dexto/analytics@1.2.3
    - @dexto/core@1.2.3

## 0.2.2

### Patch Changes

- 4a3b1b5: Add changeset for new mcp servers
- 8b96b63: Add posthog analytics package and add to web ui
- Updated dependencies [8b96b63]
    - @dexto/analytics@1.2.2
    - @dexto/core@1.2.2

## 0.2.1

### Patch Changes

- 9a26447: Fix starter prompts
    - @dexto/core@1.2.1

## 0.2.0

### Minor Changes

- 1e25f91: Update web UI to be default, fix port bugs, update docs

### Patch Changes

- 72ef45c: Fix minor spinner bug
- 3a65cde: Update older LLMs to new LLMs, update docs
- 70a78ca: Update webUI to handle different sizes, mobile views, improve model picker UI
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
- 930a4ca: Fixes in UI, docs and agents
- 2940fbf: Add changeset for playground ui updates
- 930d75a: Add mcp server restart feature and button in webUI
- 3fc6716: Add changeset for new servers & webui fixes.
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

## 0.1.8

### Patch Changes

- c40b675: - Updated toolResult sanitization flow
    - Added support for video rendering to WebUI
- 015100c: Added new memory manager for creating, storing and managing memories.
    - FileContributor has a new memories contributor for loading memories into SystemPrompt.
- 2b81734: Updated WebUI for MCP connection flow and other minor updates
- 5cc6933: Fixes for prompts/resource management, UI improvements, custom slash command support, add support for embedded/linked resources, proper argument handling for prompts
- 40f89f5: Add New Agent buttons, form editor, new APIs, Dexto class
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

- 1da4398: Added support for video rendering in webui & updated thinking label
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
- 0700f6f: Support for in-built and custom plugins
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

## 0.1.7

### Patch Changes

- @dexto/core@1.1.10

## 0.1.6

### Patch Changes

- 27778ba: Add claude 4.5 sonnet and make it default
- Updated dependencies [27778ba]
    - @dexto/core@1.1.9

## 0.1.5

### Patch Changes

- Updated dependencies [d79d358]
    - @dexto/core@1.1.8

## 0.1.4

### Patch Changes

- @dexto/core@1.1.7

## 0.1.3

### Patch Changes

- e6d029c: Update logos and fix build
    - @dexto/core@1.1.6

## 0.1.2

### Patch Changes

- e523d86: Add keyboard shortcut to delete session
- Updated dependencies [e2bd0ce]
- Updated dependencies [11cbec0]
- Updated dependencies [795c7f1]
- Updated dependencies [9d7541c]
    - @dexto/core@1.1.5

## 0.1.1

### Patch Changes

- 2fccffd: Migrating to monorepo
- Updated dependencies [2fccffd]
    - @dexto/core@1.1.4
