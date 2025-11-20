# Dexto Client SDK

An ultra-lightweight, zero-dependency HTTP client SDK for the Dexto API.

## Features

- 🚀 **Ultra-lightweight**: Only 80KB bundle size
- 🔌 **Zero dependencies**: No external libraries
- 🌐 **Universal**: Works in Node.js, browsers, and React Native
- 📡 **HTTP + SSE**: Full REST API and real-time SSE streaming support
- 🛡️ **TypeScript**: Full type safety
- 🔄 **Auto-retry**: Built-in retry logic with exponential backoff
- ⚡ **Fast**: Server-side validation, client-side pass-through

## Installation

```bash
npm install @dexto/client-sdk
```

## Quick Start

```typescript
import { DextoClient } from '@dexto/client-sdk';

const client = new DextoClient({
  baseUrl: 'https://your-dexto-server.com',
  apiKey: 'optional-api-key'
});

// Connect to Dexto server
await client.connect();

// Send a message
const response = await client.sendMessage({
  content: 'Hello, how can you help me?'
});

console.log(response.response);
```

## Configuration

```typescript
const client = new DextoClient({
  baseUrl: 'https://your-dexto-server.com',  // Required: Dexto API base URL
  apiKey: 'your-api-key',                   // Optional: API key for auth
  timeout: 30000,                           // Optional: Request timeout (ms)
  retries: 3,                              // Optional: Retry attempts
}, {
  reconnect: true,                         // Optional: Auto-reconnect
  reconnectInterval: 5000,                 // Optional: Reconnect delay (ms)
  debug: false                             // Optional: Debug logging
});
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

This SDK follows the **thin client** philosophy:

- ✅ **Pass-through**: Data goes directly to Dexto server
- ✅ **Server validation**: Let the Dexto server handle all validation
- ✅ **Simple errors**: Return server errors as-is
- ✅ **Type safety**: Full TypeScript support
- ✅ **Fast**: Minimal client-side processing

## Bundle Size

- **Total**: ~80KB
- **Main bundle**: ~25KB
- **Type definitions**: ~10KB
- **Zero external dependencies**
