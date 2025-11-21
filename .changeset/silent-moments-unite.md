---
'@dexto/client-sdk': patch
'@dexto/analytics': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Migrate from WebSocket to Server-Sent Events (SSE) for real-time streaming

- Replace WebSocket with SSE for message streaming via new `/api/message-stream` endpoint
- Refactor approval system from event-based providers to simpler handler pattern
- Add new APIs for session approval
- Move session title generation to a separate API
- Add `ApprovalCoordinator` for multi-client SSE routing with sessionId mapping
- Add stream and generate methods to DextoAgent and integ tests for itq=

