# Webhook API Documentation

The Dexto webhook system provides HTTP-based event delivery for agent events, offering an alternative to SSE streams for cloud integrations.

## Overview

Webhooks allow you to receive real-time notifications about agent events by registering HTTP endpoints that will receive POST requests when events occur. This is similar to how Stripe webhooks work - when something happens in your Dexto agent, we'll send a POST request to your configured webhook URL.

## Event Structure

All webhook events follow a consistent structure inspired by Stripe's webhook events:

```typescript
interface DextoWebhookEvent<T extends AgentEventName = AgentEventName> {
    id: string;              // Unique event ID (e.g., "evt_1234567890_abc123def")
    type: T;                 // Event type with TypeScript autocomplete
    data: AgentEventMap[T];  // Event-specific payload
    created: string;         // ISO-8601 timestamp of when the event occurred
    apiVersion: string;      // API version (currently "2025-07-03")
}
```

## TypeScript Autocomplete Support

The webhook system provides full TypeScript autocomplete support for event types, similar to Stripe's implementation:

```typescript
// Your IDE will autocomplete available event types
if (event.type === "llm:response") {
    // TypeScript knows event.data has response-specific fields
    console.log(event.data.content);
    console.log(event.data.tokenUsage?.totalTokens);
}
```

## Available Event Types

The webhook system supports all integration events (Tier 2 events):

**LLM Events:**
- `llm:thinking` - AI model is processing
- `llm:chunk` - Streaming response chunk received
- `llm:tool-call` - Tool execution requested
- `llm:tool-result` - Tool execution completed
- `llm:response` - Final AI response received
- `llm:error` - Error during AI processing
- `llm:unsupported-input` - Input type not supported by selected model
- `llm:switched` - LLM provider or model switched

**Session Events:**
- `session:title-updated` - Session title was automatically updated
- `session:created` - New conversation session created
- `session:reset` - Conversation history cleared

**MCP Events:**
- `mcp:server-connected` - MCP server connection established
- `mcp:server-restarted` - MCP server was restarted
- `mcp:tools-list-changed` - MCP server tools changed
- `mcp:prompts-list-changed` - MCP server prompts changed

**Tool Events:**
- `tools:available-updated` - Available tools changed (MCP + built-in)

**State Events:**
- `state:changed` - Agent state updated

## Webhook Management API

### Register a Webhook

```bash
POST /api/webhooks
Content-Type: application/json

{
    "url": "https://your-app.com/webhooks/dexto",
    "secret": "whsec_your_secret_key",  // Optional for signature verification
    "description": "Production webhook"  // Optional description
}
```

Response:
```json
{
    "webhook": {
        "id": "wh_1703123456_abc123def",
        "url": "https://your-app.com/webhooks/dexto",
        "description": "Production webhook",
        "createdAt": "2025-01-01T12:00:00.000Z"
    }
}
```

### List Webhooks

```bash
GET /api/webhooks
```

### Get Specific Webhook

```bash
GET /api/webhooks/{webhook_id}
```

### Remove Webhook

```bash
DELETE /api/webhooks/{webhook_id}
```

### Test Webhook

```bash
POST /api/webhooks/{webhook_id}/test
```

This sends a test `tools:available-updated` event to verify your endpoint is working.

## Security & Signature Verification

When you provide a `secret` during webhook registration, Dexto will include an HMAC signature in the `X-Dexto-Signature-256` header for verification:

```
X-Dexto-Signature-256: sha256=a1b2c3d4e5f6...
```

### Verifying Signatures (Node.js Example)

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex');
    
    const expected = `sha256=${expectedSignature}`;
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expected, 'utf8')
    );
}

// In your webhook handler
app.post('/webhooks/dexto', async (c) => {
    const signature = c.req.header('x-dexto-signature-256');
    const payload = await c.req.text();

    if (!verifyWebhookSignature(payload, signature, 'your_secret')) {
        return c.text('Unauthorized', 401);
    }

    // Parse only *after* signature verification
    const event = JSON.parse(payload);
    console.log(`Received ${event.type} event:`, event.data);

    return c.text('OK', 200);
});
```

## HTTP Headers

Each webhook request includes these headers:

- `Content-Type: application/json`
- `User-Agent: DextoAgent/1.0`
- `X-Dexto-Event-Type: {event_type}`
- `X-Dexto-Event-Id: {event_id}`
- `X-Dexto-Delivery-Attempt: {attempt_number}`
- `X-Dexto-Signature-256: sha256={signature}` (if secret provided)

## Delivery & Retry Logic

- **Delivery**: Webhooks are delivered asynchronously and don't block agent operations
- **Timeout**: 10 second timeout per request
- **Retries**: Up to 3 attempts with exponential backoff (1s, 2s, 4s)
- **Success**: HTTP 2xx status codes are considered successful
- **Failure**: Non-2xx responses or network errors trigger retries

## Best Practices

1. **Respond Quickly**: Return a 2xx status code as fast as possible. Process events asynchronously if needed.

2. **Handle Duplicates**: Due to retries, you might receive the same event multiple times. Use the `event.id` for deduplication.

3. **Verify Signatures**: Always verify webhook signatures in production to ensure requests are from Dexto.

4. **Use HTTPS**: Always use HTTPS URLs for webhook endpoints to ensure secure delivery.

5. **Handle All Event Types**: Your webhook should handle unknown event types gracefully as new events may be added.

## Example Webhook Handler

```typescript
import { Hono } from 'hono';
import type { DextoWebhookEvent } from '@dexto/server';

const app = new Hono();

app.post('/webhooks/dexto', async (c) => {
    // Parse JSON from request body
    const event: DextoWebhookEvent = await c.req.json();

    try {
        switch (event.type) {
            case 'llm:response':
                console.log('AI Response:', event.data.content);
                break;

            case 'llm:tool-call':
                console.log('Tool Called:', event.data.toolName);
                break;

            case 'session:reset':
                console.log('Conversation reset for session:', event.data.sessionId);
                break;

            default:
                console.log('Unknown event type:', event.type);
        }

        return c.text('OK', 200);
    } catch (error) {
        console.error('Webhook error:', error);
        return c.text('Internal Server Error', 500);
    }
});
```

## Differences from SSE

| Feature | SSE | Webhooks |
|---------|-----|----------|
| Connection | Persistent connection required | Stateless HTTP requests |
| Delivery | Real-time | Near real-time with retries |
| Scalability | Limited by connection count | Scales with HTTP infrastructure |
| Reliability | Connection can drop | Built-in retry mechanism |
| Development | Requires EventSource client | Standard HTTP endpoint |
| Cloud-friendly | Requires persistent connections | Works with serverless functions |

## Server Mode Requirement

Webhooks are only available when Dexto is running in server mode (`dexto --mode server` command). They are not available in CLI or other modes since webhooks require the HTTP API server to be running.
