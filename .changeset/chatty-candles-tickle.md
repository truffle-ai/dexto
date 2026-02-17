---
'@dexto/agent-management': patch
'@dexto/tools-filesystem': patch
'@dexto/tools-lifecycle': patch
'@dexto/tools-builtins': patch
'@dexto/orchestration': patch
'@dexto/tools-process': patch
'@dexto/agent-config': patch
'@dexto/tools-plan': patch
'@dexto/tools-todo': patch
'@dexto/core': patch
'dexto': patch
---

Tool type-safety + validation improvements

- Preserve Zod-derived input types through `defineTool()`/`Tool<TSchema>` so tool factories expose typed `execute()` inputs to callers.
- Centralize local tool arg validation in ToolManager (and re-validate after hook mutation) so tools always receive schema-validated args and defaults/coercions are consistently applied.
- Refactor filesystem tool directory-access approvals to share a single helper and keep approval/execution path resolution consistent.
- Small UX/consistency fixes across plan/process/orchestration tools and the CLI config summary output.
