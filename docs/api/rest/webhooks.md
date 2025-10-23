---
sidebar_position: 11
---

# Webhook Management

## List Webhooks
*Retrieves a list of all registered webhooks.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/webhooks</code></p>

### Responses

#### Success (200)
```json
{
  "webhooks": [
    {
      "id": "wh_1698403200000_abc123xyz",
      "url": "https://example.com/webhooks/dexto",
      "description": "Production webhook endpoint",
      "createdAt": "2023-10-27T10:00:00.000Z"
    }
  ]
}
```

## Register Webhook
*Registers a new webhook endpoint to receive agent events.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/webhooks</code></p>

### Request Body
- `url` (string, required): The URL to send webhook events to. Must be a valid HTTP/HTTPS URL.
- `secret` (string, optional): A secret key for HMAC signature verification. When provided, webhook payloads will include an `X-Dexto-Signature-256` header.
- `description` (string, optional): A description of the webhook for reference.

### Responses

#### Success (201)
```json
{
  "webhook": {
    "id": "wh_1698403200000_abc123xyz",
    "url": "https://example.com/webhooks/dexto",
    "description": "Production webhook endpoint",
    "createdAt": "2023-10-27T10:00:00.000Z"
  }
}
```

#### Error (400)
```json
{
  "error": "Invalid URL format"
}
```

## Get Webhook Details
*Fetches details for a specific webhook.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/webhooks/:webhookId</code></p>

### Responses

#### Success (200)
```json
{
  "webhook": {
    "id": "wh_1698403200000_abc123xyz",
    "url": "https://example.com/webhooks/dexto",
    "description": "Production webhook endpoint",
    "createdAt": "2023-10-27T10:00:00.000Z"
  }
}
```

#### Error (404)
```json
{
  "error": "Webhook not found"
}
```

## Test Webhook
*Sends a sample event to test webhook connectivity and configuration.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/webhooks/:webhookId/test</code></p>

### Responses

#### Success (200)
```json
{
  "test": "completed",
  "result": {
    "success": true,
    "statusCode": 200,
    "responseTime": 145
  }
}
```

#### Success with Failure (200)
```json
{
  "test": "completed",
  "result": {
    "success": false,
    "statusCode": 500,
    "responseTime": 203,
    "error": "HTTP 500: Internal Server Error"
  }
}
```

#### Error (404)
```json
{
  "error": "Webhook not found"
}
```

## Delete Webhook
*Permanently removes a webhook endpoint. This action cannot be undone.*

<p class="api-endpoint-header"><span class="api-method delete">DELETE</span><code>/api/webhooks/:webhookId</code></p>

### Responses

#### Success (200)
```json
{
  "status": "removed",
  "webhookId": "wh_1698403200000_abc123xyz"
}
```

#### Error (404)
```json
{
  "error": "Webhook not found"
}
```

## Webhook Event Delivery

### Event Payload Structure
All webhook events follow a consistent structure inspired by Stripe's webhook design:

```json
{
  "id": "evt_1698403200000_xyz123abc",
  "type": "llmservice:chunk",
  "data": {
    "type": "text",
    "content": "Hello world",
    "sessionId": "b4a2a3e8-72b1-4d00-a5c3-1a2c3d4e5f6a"
  },
  "created": "2023-10-27T10:00:00.000Z",
  "apiVersion": "2025-07-03"
}
```

### HTTP Headers
Each webhook request includes the following headers:

- `Content-Type: application/json`
- `User-Agent: DextoAgent/1.0`
- `X-Dexto-Event-Type`: The event type (e.g., `llmservice:chunk`)
- `X-Dexto-Event-Id`: Unique identifier for this event
- `X-Dexto-Delivery-Attempt`: Current delivery attempt number (1-3)
- `X-Dexto-Signature-256`: HMAC signature (only if webhook has a secret)

### Signature Verification
When a webhook is registered with a `secret`, all payloads include an `X-Dexto-Signature-256` header for verification:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  return signature === expectedSignature;
}

// Express.js example
app.post('/webhooks/dexto', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-dexto-signature-256'];
  const payload = req.body;

  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  // Process the event
  const event = JSON.parse(payload);
  console.log('Received event:', event.type);

  res.status(200).send('OK');
});
```

### Event Types
Webhooks receive all agent and session events:

**Agent-level events:**
- `dexto:conversationReset` - Conversation was reset
- `dexto:mcpServerConnected` - MCP server connection status changed
- `dexto:availableToolsUpdated` - Available tools list updated
- `dexto:llmSwitched` - LLM provider/model switched
- `dexto:stateChanged` - Agent state changed
- `dexto:approvalRequest` - User approval requested
- `dexto:approvalResponse` - User approval response received

**Session-level events:**
- `llmservice:thinking` - LLM started processing
- `llmservice:chunk` - Streaming response chunk received
- `llmservice:response` - Final response completed
- `llmservice:toolCall` - Tool execution started
- `llmservice:toolResult` - Tool execution completed
- `llmservice:error` - Error occurred during processing

### Delivery Behavior

**Retry Logic:**
- Failed deliveries are automatically retried up to 3 times
- Exponential backoff with jitter (1s → 2s → 4s delays)
- Maximum backoff delay: 10 seconds
- Timeout per request: 10 seconds

**Success Criteria:**
- HTTP status codes 200-299 are considered successful
- All other status codes trigger retry logic
- Network errors and timeouts also trigger retries

**Testing:**
Use the test endpoint to verify webhook configuration without waiting for real events. The test sends a sample `dexto:availableToolsUpdated` event and reports delivery results including status code, response time, and any errors.
