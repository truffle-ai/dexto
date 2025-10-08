---
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Add blob storage system for persistent binary data management:
  - Implement blob storage backend with local filesystem support
  - Add blob:// URI scheme for referencing stored blobs
  - Integrate blob storage with resource system for seamless @resource references
  - Add automatic blob expansion in chat history and message references
  - Add real-time cache invalidation events for resources and prompts
  - Fix prompt cache invalidation WebSocket event handling in WebUI
  - Add robustness improvements: empty text validation after resource expansion and graceful blob expansion error
  handling
  - Support image/file uploads with automatic blob storage
  - Add WebUI components for blob resource display and autocomplete
