---
'@dexto/image-logger-agent': patch
'@dexto/agent-management': patch
'@dexto/tools-filesystem': patch
'@dexto/tools-lifecycle': patch
'@dexto/tools-builtins': patch
'@dexto/image-bundler': patch
'@dexto/orchestration': patch
'@dexto/tools-process': patch
'@dexto/agent-config': patch
'@dexto/image-local': patch
'@dexto/tools-plan': patch
'@dexto/tools-todo': patch
'@dexto/storage': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Refactors
- Agent config terminology updates:
  - `toolConfirmation` → `permissions`
  - `internalResources` → `resources` (and removes the unused `enabled` flag)
  - runtime “plugins” → “hooks” (to avoid confusion with Claude Code-style plugins)
- CLI UX: removes headless/positional prompt mode; `--prompt` now starts the interactive CLI with an initial prompt.
- Tool surface refactor: removes `custom`/`internal` tool ID prefixes; MCP tools remain namespaced.
- New and updated tools:
  - Adds built-in Exa `web_search` + `code_search` tools.
  - Enables built-in `http_request` (“Fetch”) in the default and coding agents.
  - Refines tool display names for readability (e.g. “Update Todos”, “Web Search”, “Code Search”, “Check Task”, “List Tasks”).
  - Adds `@dexto/tools-lifecycle` (view logs + memory management) and moves session search into lifecycle tools.
- UI terminology: “task list” → “todo list”.
- Images:
  - `DextoImageModule` renamed to `DextoImage`.
  - `dexto image create` scaffold includes minimal examples for tools/hooks/storage/compaction.
