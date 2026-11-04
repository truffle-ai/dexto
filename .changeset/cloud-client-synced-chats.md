---
'@dexto/cloud-client': patch
---

The client covers Dexto's synced chat operations (`/v1/synced_chats`, its moves and messages) from the current `/v1` OpenAPI document, and a `CloudApiError` carries `retryAfterSeconds` from the response's `Retry-After` header.
