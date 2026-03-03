# @dexto/registry

## 1.6.7

### Patch Changes

- 785978b: Fix upload standalone bianries release tag finding logic

## 1.6.6

### Patch Changes

- 7e2bcd2: fix windows escape sequence

## 1.6.5

### Patch Changes

- 60aab0e: Fix windows build for binary distribution

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution

## 1.6.3

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

### Patch Changes

- 6df3ca9: Updated readme. Removed stale filesystem and process tool from dexto/core.

## 1.5.4

## 1.5.3

## 1.5.2

## 1.5.1

## 1.5.0

### Minor Changes

- e7722e5: Minor version bump for new release with bundler, custom tool pkgs, etc.

## 1.4.0

### Minor Changes

- f73a519: Revamp CLI. Breaking change to DextoAgent.generate() and stream() apis and hono message APIs, so new minor version. Other fixes for logs, web UI related to message streaming/generating
