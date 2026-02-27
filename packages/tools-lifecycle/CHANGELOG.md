# @dexto/tools-lifecycle

## 1.6.5

### Patch Changes

- 60aab0e: Fix windows build for binary distribution
- Updated dependencies [60aab0e]
- Updated dependencies [19a4983]
    - @dexto/agent-config@1.6.5
    - @dexto/core@1.6.5

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution
- Updated dependencies [7cb9082]
    - @dexto/agent-config@1.6.4
    - @dexto/core@1.6.4

## 1.6.3

### Patch Changes

- @dexto/core@1.6.3
- @dexto/agent-config@1.6.3

## 1.6.2

### Patch Changes

- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/core@1.6.2
    - @dexto/agent-config@1.6.2

## 1.6.1

### Patch Changes

- 112dadf: - CLI/TUI: cleaner overlays (selectors, approvals, elicitation) with consistent sizing to reduce flicker on small terminals.
    - Tools: richer pre-approval previews (files/diffs, bash commands, plans) and clearer tool output formatting in message history.
    - Filesystem approvals: directory access checks now handle symlinks/realpaths consistently so approved directories actually work (e.g. `/tmp` on macOS).
    - ask_user: wizard-style elicitation flow with a deterministic schema contract (field `title`/`description` + `x-dexto.stepLabel`).
    - Reliability & build: deterministic `http_request` tests (no network) and faster builds by separating JS bundling from DTS generation.
- Updated dependencies [03d4564]
- Updated dependencies [112dadf]
    - @dexto/core@1.6.1
    - @dexto/agent-config@1.6.1

## 1.6.0

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
    - @dexto/agent-config@1.6.0
    - @dexto/core@1.6.0
