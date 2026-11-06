---
"dexto": patch
"@dexto/server": patch
---

The web/server API now binds to `127.0.0.1` by default and enforces bearer auth whenever `DEXTO_SERVER_API_KEY` is set.

Behavior changes:

- `dexto --mode web` / `--mode server`, `startDextoServer`, and `createNodeServer` listen on `127.0.0.1` unless a host is given (`--host`, `DEXTO_SERVER_HOST`, or the `hostname` option). Previously they listened on `0.0.0.0`.
- Listening on any non-loopback host (including `0.0.0.0` and `localhost`) requires `DEXTO_SERVER_API_KEY`; startup fails without it. Apps created with `disableAuth: true` are exempt.
- When `DEXTO_SERVER_API_KEY` is set, every protected request needs `Authorization: Bearer <key>`, also outside production. The bundled Web UI does not send a key, so leave it unset to use the Web UI locally.
- The Docker image sets `DEXTO_SERVER_HOST=0.0.0.0`, so it now requires `DEXTO_SERVER_API_KEY` to start.
