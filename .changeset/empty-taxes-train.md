---
'@dexto/image-logger-agent': minor
'@dexto/agent-management': minor
'@dexto/tools-filesystem': minor
'@dexto/tools-builtins': minor
'@dexto/image-bundler': minor
'@dexto/orchestration': minor
'@dexto/tools-process': minor
'@dexto/agent-config': minor
'@dexto/image-local': minor
'@dexto/client-sdk': minor
'@dexto/tools-plan': minor
'@dexto/tools-todo': minor
'@dexto/analytics': minor
'@dexto/registry': minor
'@dexto/storage': minor
'@dexto/server': minor
'@dexto/webui': minor
'@dexto/core': minor
'dexto': minor
---

Rebuild DI + image-based config resolution

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
