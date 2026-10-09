# Dexto Client SDK

A TypeScript HTTP client for Dexto servers, with a separate entrypoint for authenticated Cloud discovery.

## Features

- 🔌 **Separate exports**: Local server and Cloud discovery clients
- 🌐 **Universal**: Works in Node.js, browsers, and React Native
- 📡 **HTTP + SSE**: Full REST API and real-time SSE streaming support
- 🛡️ **TypeScript**: Full type safety
- 🔄 **Auto-retry**: Built-in retry logic with exponential backoff
- ⚡ **Cloud contracts**: Validated discovery requests and responses

## Installation

```bash
npm install @dexto/client-sdk
```

## Cloud discovery

```typescript
import { createDextoCloudClient } from '@dexto/client-sdk/cloud';

const cloud = createDextoCloudClient({
    origin: 'https://app.dexto.ai',
    token: 'your-dexto-api-key',
    fetch: globalThis.fetch,
});

const sources = await cloud.sources({ limit: 20 });
const matches = await cloud.search({ query: 'web search', limit: 10 });
const description = await cloud.describe('dexto.platform.web_search');
```

Use an organization credential with `capabilities:read`. Results include schemas and execution/availability metadata; discovery does not grant permission to invoke a capability. Cloud validates current membership and credential permissions on each request.

The CLI uses the same discovery client:

```bash
dexto login
dexto cloud sources --json
dexto cloud search "web search" --limit 10 --json
dexto cloud describe dexto.platform.web_search --json
```

Search returns `hasMore`, `nextOffset`, and `total`. Pass `--offset` for the next page. JSON failures contain an `error` object and exit with code 1. Human-readable output is the default.

For another installation, use `dexto login --platform-url <application-origin>`. The saved key remains bound to that origin, including when the same key appears in the environment. A different `DEXTO_API_KEY` can select another origin with `--platform-url` or `DEXTO_PLATFORM_URL`. Legacy saved keys without origin metadata use `https://app.dexto.ai`.

## Quick Start

```typescript
import { DextoClient } from '@dexto/client-sdk';

const client = new DextoClient({
    baseUrl: 'https://your-dexto-server.com',
    apiKey: 'optional-api-key',
});

// Connect to Dexto server
await client.connect();

// Send a message
const response = await client.sendMessage({
    content: 'Hello, how can you help me?',
});

console.log(response.response);
```

## Configuration

```typescript
const client = new DextoClient(
    {
        baseUrl: 'https://your-dexto-server.com', // Required: Dexto API base URL
        apiKey: 'your-api-key', // Optional: API key for auth
        timeout: 30000, // Optional: Request timeout (ms)
        retries: 3, // Optional: Retry attempts
    },
    {
        reconnect: true, // Optional: Auto-reconnect
        reconnectInterval: 5000, // Optional: Reconnect delay (ms)
        debug: false, // Optional: Debug logging
    }
);
```

## API Methods

### Connection Management

- `connect()` - Establish connection to Dexto server
- `disconnect()` - Close connection
- `isConnected` - Check connection status

### Messaging

- `sendMessage(input)` - Send message (HTTP)
- SSE streaming available via `/api/message-stream` endpoint

### Session Management

- `listSessions()` - List all sessions
- `createSession(id?)` - Create new session
- `getSession(id)` - Get session details
- `deleteSession(id)` - Delete session

### Real-time Events

- `on(eventType, handler)` - Subscribe to Dexto events
- `onConnectionState(handler)` - Connection state changes

## Error Handling

```typescript
try {
    await client.sendMessage({ content: 'Hello' });
} catch (error) {
    if (error.name === 'ConnectionError') {
        console.log('Failed to connect to Dexto server');
    } else if (error.name === 'HttpError') {
        console.log(`HTTP ${error.status}: ${error.statusText}`);
    }
}
```

## Philosophy

The agent-server export is a thin typed transport client. The Cloud export validates discovery request inputs and successful response contracts, and reports typed HTTP, network, and incompatible-response errors. Server-side authorization and product policy remain with the server.

## Dependencies

The published package uses Hono for the agent-server client and Zod for Cloud discovery validation. The separate Cloud export does not import Core or the local server runtime.
