---
"@dexto/server": patch
"@dexto/client-sdk": patch
---

Validate Origin and Host on the local API server and require a non-simple header on state-changing requests.

Behavior changes:

- `POST`/`PUT`/`PATCH`/`DELETE` requests are rejected with `403` when their `Origin` is not loopback, not in `DEXTO_ALLOWED_ORIGINS`, and not the server's own origin, when `Sec-Fetch-Site` is `cross-site`, or when they send none of `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type` (for example `application/json`). `@dexto/client-sdk` now sends `X-Dexto-Request: 1`; scripts that POST without a body or with `text/plain` need to add that header.
- When the server runs without auth (no API key, not production, no `DEXTO_SERVER_REQUIRE_AUTH`), requests must use a loopback `Host` header (`localhost`, `127.x.x.x`, `0.0.0.0`, `[::1]`). Other names can be allowed with `DEXTO_ALLOWED_HOSTS`.
