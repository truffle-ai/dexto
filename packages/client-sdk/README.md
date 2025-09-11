# @dexto/client-sdk

A lightweight TypeScript/JavaScript SDK for interacting with a running Dexto server via HTTP (and optional WebSocket in browser environments).

## Install

This package is part of the Dexto monorepo and is published as `@dexto/client-sdk`.

```
pnpm add @dexto/client-sdk
```

## Usage

```ts
import { DextoClient } from '@dexto/client-sdk';

const client = new DextoClient(
  { baseUrl: 'http://localhost:3001' },
  { enableWebSocket: false } // Node: disable WebSocket, use HTTP only
);

await client.connect();
const session = await client.createSession();
const res = await client.sendMessage({ content: 'Hello!', sessionId: session.id, stream: false });
console.log(res.response);
```

## Notes
- In Node.js, set `enableWebSocket: false` (browser WebSocket is not available by default).
- The SDK validates inputs and outputs using Zod schemas.
- If you expose custom HTTP endpoints, you can still call them via `client.http` helpers.

```ts
// Example: list sessions
const sessions = await client.listSessions();
```

