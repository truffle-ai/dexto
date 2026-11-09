---
'dexto': minor
'@dexto/server': minor
'@dexto/client-sdk': patch
'@dexto/webui': patch
---

**Upgrade note: the local API server now checks Origin and Host.** Frontends on another port, scripts sending simple POST requests, and unauthenticated clients using a non-loopback Host may need configuration after upgrading.

For a frontend at another origin, allow its exact origin when starting the server:

```bash
DEXTO_ALLOWED_ORIGINS=http://localhost:5173 dexto --mode server
```

For a POST with no body or `text/plain`, add the request header:

```bash
curl -X POST -H 'X-Dexto-Request: 1' http://localhost:3001/api/message
```

For an unauthenticated server accessed using a non-loopback Host name, allow that name:

```bash
DEXTO_ALLOWED_HOSTS=myhost dexto --mode server
```

Validate Origin and Host on the local API server and require a non-simple header on state-changing requests.

Behavior changes:

- Browser origins are trusted per origin, not per host: only the server's own origin (the `Origin` host and port match the request `Host`) and origins listed in `DEXTO_ALLOWED_ORIGINS` are accepted. Pages on other `localhost`/`127.0.0.1`/`[::1]` ports are no longer trusted, and CORS headers are sent only for `DEXTO_ALLOWED_ORIGINS`. A frontend on another port must be added to `DEXTO_ALLOWED_ORIGINS`.
- Any request with an untrusted `Origin` (or `Origin: null`) is rejected with `403`. `POST`/`PUT`/`PATCH`/`DELETE` requests are also rejected when `Sec-Fetch-Site` is `same-site` or `cross-site` from an origin not in `DEXTO_ALLOWED_ORIGINS`, or when they send none of `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type` (for example `application/json`). `@dexto/client-sdk` now sends `X-Dexto-Request: 1`; scripts that POST without a body or with `text/plain` need to add that header.
- When the server runs without auth (no API key, not production, no `DEXTO_SERVER_REQUIRE_AUTH`), requests must use a loopback `Host` header (`localhost`, `127.x.x.x`, `0.0.0.0`, `[::1]`). Other names can be allowed with `DEXTO_ALLOWED_HOSTS`.
