---
sidebar_position: 9
---

# Hosting an SDK agent

Use `@dexto/server` to expose an agent initialized by your application through HTTP and streaming APIs.
See the [SDK guide](./dexto-sdk.md) for agent configuration and initialization.

```typescript
import { startDextoServer } from '@dexto/server';

// Pass the agent initialized by your application.
const { stop } = await startDextoServer(agent, { port: 3001 });

// Call stop() when your application shuts down.
```

The 2.0 CLI runs terminal agents and cloud commands. The removed `--mode server`, `--mode web`
and repository Docker image are not hosting entry points; see the
[removed-command replacements](./cli/overview.md#removed-in-20).

## Network access and authentication

SDK servers listen on `127.0.0.1` by default. To accept connections from other hosts, pass
`hostname: '0.0.0.0'` to `startDextoServer`, or set `DEXTO_SERVER_HOST`, and configure
`DEXTO_SERVER_API_KEY`. Startup refuses a non-loopback bind without a key. When the key is set,
API requests must send `Authorization: Bearer <key>`; `/health` remains public. A bare key in the
Authorization header is not accepted. `DEXTO_SERVER_REQUIRE_AUTH=true` also requires authentication
in development. Applications that explicitly disable built-in authentication own that boundary.

Supply model credentials through the agent's configuration. Keep the listener behind your
application's access controls and arrange for its shutdown handler to await `stop()`, which closes
the server, event subscribers and agent.

## Origin and Host checks

Allow a frontend on another origin with `DEXTO_ALLOWED_ORIGINS`, for example
`http://localhost:5173`. Scripts sending a POST without a body or with `text/plain` must add
`X-Dexto-Request: 1`. For an unauthenticated server accessed using a non-loopback Host name,
allow the hostname with `DEXTO_ALLOWED_HOSTS`.

See the [REST API reference](/api/rest/) for endpoints and the
[SDK events reference](/api/sdk/events) for streaming event types.
