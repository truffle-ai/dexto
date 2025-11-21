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
- Add `ApprovalCoordinator` for multi-client SSE routing with sessionId mapping
- Fix approval flow consistency: timeout/cancel now resolve instead of reject
- Add 404/503 error responses to OpenAPI documentation
- Update JSDoc examples to include required sessionId parameter
- Improve abort signal handling in EventStreamClient
