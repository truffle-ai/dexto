---
"@dexto/server": patch
"@dexto/client-sdk": patch
---

Validate Origin and Host on the local API server and require a non-simple header on state-changing requests.

Behavior changes:

- `POST`/`PUT`/`PATCH`/`DELETE` requests are rejected with `403` when their `Origin` is not loopback or in `DEXTO_ALLOWED_ORIGINS`, when `Sec-Fetch-Site` is `cross-site`, or when they send none of `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type` (for example `application/json`). `@dexto/client-sdk` now sends `X-Dexto-Request: 1`; scripts that POST without a body or with `text/plain` need to add that header.
- When the server runs without an API key, requests must use a loopback `Host` header. Other names can be allowed with `DEXTO_ALLOWED_HOSTS`.
