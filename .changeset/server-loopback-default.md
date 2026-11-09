---
'dexto': minor
'@dexto/server': minor
---

**Upgrade note: `dexto --mode server` and `--mode web` now listen on 127.0.0.1 only.** If other hosts or containers reach your server, bind it to a network host with a key after upgrading. Replace `<key>` with a strong secret in these examples.

```bash
DEXTO_SERVER_API_KEY='<key>' dexto --mode server --host 0.0.0.0

# Or configure the bind address through the environment:
DEXTO_SERVER_HOST=0.0.0.0 DEXTO_SERVER_API_KEY='<key>' dexto --mode server

# The image binds to 0.0.0.0 and needs a key to start:
docker run -e DEXTO_SERVER_API_KEY='<key>' -p 3001:3001 dexto
```

For an embedded server, set `DEXTO_SERVER_API_KEY` in its environment and pass a hostname:

```ts
await startDextoServer(agent, { hostname: '0.0.0.0' });
```

Clients must send `Authorization: Bearer <key>`. The bundled Web UI does not send a key, so leave `DEXTO_SERVER_API_KEY` unset when using it locally. See the [deployment guide](https://cli.dexto.ai/docs/guides/deployment).

The web/server API now binds to `127.0.0.1` by default and enforces bearer auth whenever `DEXTO_SERVER_API_KEY` is set.

Behavior changes:

- `dexto --mode web` / `--mode server`, `startDextoServer`, and `createNodeServer` listen on `127.0.0.1` unless a host is given (`--host`, `DEXTO_SERVER_HOST`, or the `hostname` option). Previously they listened on `0.0.0.0`.
- Listening on any non-loopback host (including `0.0.0.0` and `localhost`) requires `DEXTO_SERVER_API_KEY`; startup fails without it. Apps created with `disableAuth: true` are exempt.
- When `DEXTO_SERVER_API_KEY` is set, every protected request needs `Authorization: Bearer <key>`, also outside production. The bundled Web UI does not send a key, so leave it unset to use the Web UI locally.
- Code that embeds the server with `startDextoServer` or `createNodeServer` and expects other hosts (containers, PaaS) to reach it must now pass `hostname: '0.0.0.0'` (or set `DEXTO_SERVER_HOST`) and set `DEXTO_SERVER_API_KEY`; without a hostname it listens on loopback only.
- The Docker image sets `DEXTO_SERVER_HOST=0.0.0.0`, so it now requires `DEXTO_SERVER_API_KEY` to start.
