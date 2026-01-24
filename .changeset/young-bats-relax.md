---
'@dexto/agent-management': patch
'@dexto/tools-filesystem': patch
'@dexto/image-bundler': patch
'@dexto/tools-process': patch
'@dexto/image-local': patch
'@dexto/client-sdk': patch
'@dexto/tools-todo': patch
'@dexto/analytics': patch
'@dexto/registry': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

### CLI Improvements

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
