---
'@dexto/image-logger-agent': patch
'@dexto/agent-management': patch
'@dexto/tools-filesystem': patch
'@dexto/tools-lifecycle': patch
'@dexto/tools-scheduler': patch
'@dexto/tools-builtins': patch
'@dexto/image-bundler': patch
'@dexto/orchestration': patch
'@dexto/tools-process': patch
'@dexto/agent-config': patch
'@dexto/image-local': patch
'@dexto/client-sdk': patch
'@dexto/tools-plan': patch
'@dexto/tools-todo': patch
'@dexto/analytics': patch
'@dexto/registry': patch
'@dexto/storage': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
'@dexto/tui': patch
---

Add media-aware filesystem reads and resource-backed multimodal handling.

This expands supported file type capabilities for audio, video, and document inputs, preserves resource references for history and UI rehydration, and updates prompt/session handling to project multimodal content more reliably across core, server, and WebUI flows.
