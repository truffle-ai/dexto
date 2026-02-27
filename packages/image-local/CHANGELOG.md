# @dexto/image-local

## 1.6.5

### Patch Changes

- 60aab0e: Fix windows build for binary distribution
- Updated dependencies [60aab0e]
- Updated dependencies [19a4983]
    - @dexto/agent-config@1.6.5
    - @dexto/agent-management@1.6.5
    - @dexto/core@1.6.5
    - @dexto/storage@1.6.5
    - @dexto/tools-builtins@1.6.5
    - @dexto/tools-filesystem@1.6.5
    - @dexto/tools-lifecycle@1.6.5
    - @dexto/tools-plan@1.6.5
    - @dexto/tools-process@1.6.5
    - @dexto/tools-scheduler@1.6.5
    - @dexto/tools-todo@1.6.5

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution
- Updated dependencies [7cb9082]
    - @dexto/agent-config@1.6.4
    - @dexto/agent-management@1.6.4
    - @dexto/core@1.6.4
    - @dexto/storage@1.6.4
    - @dexto/tools-builtins@1.6.4
    - @dexto/tools-filesystem@1.6.4
    - @dexto/tools-lifecycle@1.6.4
    - @dexto/tools-plan@1.6.4
    - @dexto/tools-process@1.6.4
    - @dexto/tools-scheduler@1.6.4
    - @dexto/tools-todo@1.6.4

## 1.6.3

### Patch Changes

- 991739a: - Add a GitHub Actions workflow to build and upload standalone CLI binaries to existing `dexto@*` releases.
    - Add `scripts/build-standalone-binaries.sh` to compile multi-platform Bun executables, package runtime `dist/` assets, and generate SHA-256 checksums.
    - Improve standalone binary runtime bootstrapping by auto-setting `DEXTO_PACKAGE_ROOT` from the executable directory and extending WebUI asset resolution fallback paths.
    - @dexto/core@1.6.3
    - @dexto/storage@1.6.3
    - @dexto/agent-config@1.6.3
    - @dexto/agent-management@1.6.3
    - @dexto/tools-filesystem@1.6.3
    - @dexto/tools-builtins@1.6.3
    - @dexto/tools-process@1.6.3
    - @dexto/tools-todo@1.6.3
    - @dexto/tools-plan@1.6.3
    - @dexto/tools-scheduler@1.6.3
    - @dexto/tools-lifecycle@1.6.3

## 1.6.2

### Patch Changes

- 7b2c395: Added skill creation and management tools.
- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/agent-management@1.6.2
    - @dexto/core@1.6.2
    - @dexto/tools-builtins@1.6.2
    - @dexto/agent-config@1.6.2
    - @dexto/storage@1.6.2
    - @dexto/tools-filesystem@1.6.2
    - @dexto/tools-lifecycle@1.6.2
    - @dexto/tools-plan@1.6.2
    - @dexto/tools-process@1.6.2
    - @dexto/tools-scheduler@1.6.2
    - @dexto/tools-todo@1.6.2

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
    - @dexto/tools-filesystem@1.6.1
    - @dexto/tools-scheduler@1.6.1
    - @dexto/tools-process@1.6.1
    - @dexto/core@1.6.1
    - @dexto/tools-lifecycle@1.6.1
    - @dexto/tools-builtins@1.6.1
    - @dexto/agent-config@1.6.1
    - @dexto/tools-plan@1.6.1
    - @dexto/tools-todo@1.6.1
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
- 7ffa399: Added scheduler service and related tool providers.
- Updated dependencies [d6b4368]
- Updated dependencies [facabe1]
- Updated dependencies [99cf1c6]
- Updated dependencies [c862605]
- Updated dependencies [8d37b8a]
- Updated dependencies [7ffa399]
    - @dexto/agent-management@1.6.0
    - @dexto/tools-filesystem@1.6.0
    - @dexto/tools-lifecycle@1.6.0
    - @dexto/tools-builtins@1.6.0
    - @dexto/tools-process@1.6.0
    - @dexto/agent-config@1.6.0
    - @dexto/tools-plan@1.6.0
    - @dexto/tools-todo@1.6.0
    - @dexto/core@1.6.0
    - @dexto/storage@1.6.0
    - @dexto/tools-scheduler@1.6.0

## 1.5.8

### Patch Changes

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
    - @dexto/tools-filesystem@1.5.8
    - @dexto/tools-plan@1.5.8
    - @dexto/tools-process@1.5.8
    - @dexto/tools-todo@1.5.8

## 1.5.7

### Patch Changes

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
    - @dexto/tools-plan@1.5.7
    - @dexto/tools-process@1.5.7
    - @dexto/tools-filesystem@1.5.7
    - @dexto/tools-todo@1.5.7

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
    - @dexto/tools-filesystem@1.5.6
    - @dexto/tools-process@1.5.6
    - @dexto/tools-todo@1.5.6
    - @dexto/core@1.5.6

## 1.5.5

### Patch Changes

- 9ab3eac: Added todo tools.
- Updated dependencies [9ab3eac]
- Updated dependencies [63fa083]
- Updated dependencies [6df3ca9]
    - @dexto/tools-todo@0.1.1
    - @dexto/core@1.5.5
    - @dexto/tools-filesystem@1.5.5
    - @dexto/tools-process@1.5.5
    - @dexto/agent-management@1.5.5

## 1.5.4

### Patch Changes

- Updated dependencies [0016cd3]
- Updated dependencies [499b890]
- Updated dependencies [aa2c9a0]
    - @dexto/core@1.5.4
    - @dexto/agent-management@1.5.4
    - @dexto/tools-filesystem@1.5.4
    - @dexto/tools-process@1.5.4

## 1.5.3

### Patch Changes

- 4f00295: Added spawn-agent tools and explore agent.
- Updated dependencies [4f00295]
- Updated dependencies [69c944c]
    - @dexto/agent-management@1.5.3
    - @dexto/tools-filesystem@1.5.3
    - @dexto/core@1.5.3
    - @dexto/tools-process@1.5.3

## 1.5.2

### Patch Changes

- Updated dependencies [8a85ea4]
- Updated dependencies [527f3f9]
    - @dexto/core@1.5.2
    - @dexto/tools-filesystem@1.5.2
    - @dexto/tools-process@1.5.2

## 1.5.1

### Patch Changes

- Updated dependencies [bfcc7b1]
- Updated dependencies [4aabdb7]
    - @dexto/core@1.5.1
    - @dexto/tools-filesystem@1.5.1
    - @dexto/tools-process@1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

### Patch Changes

- 1e7e974: Added image bundler, @dexto/image-local and moved tool services outside core. Added registry providers to select core services.
- 5fa79fa: Renamed compression to compaction, added context-awareness to hono, updated cli tool display formatting and added integration test for image-local.
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
    - @dexto/tools-filesystem@1.5.0
    - @dexto/tools-process@1.5.0
