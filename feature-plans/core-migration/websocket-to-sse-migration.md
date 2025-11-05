# WebSocket to SSE Migration: HTTP-Only Architecture

**Status:** ⚠️ WORK IN PROGRESS - DO NOT IMPLEMENT YET
**Owner:** @me
**Scope:** Server (`@dexto/server`) + WebUI (`@dexto/webui`)
**Breaking changes:** Yes (complete API redesign)

---

## 🚧 Work In Progress Notice

This plan is not yet ready for implementation. Outstanding questions and concerns:

### Open Issues to Resolve

1. **EventSource Auth Limitations**
   - Browser EventSource cannot send custom headers (e.g., `Authorization: Bearer`)
   - Need to decide: URL token vs cookies vs custom fetch-based implementation
   - Implications for security and developer experience unclear

2. **Error Handling Strategy**
   - EventSource error events provide no context (no status codes, no error messages)
   - Need to design error event protocol
   - How to distinguish auth errors vs network errors vs server errors

3. **Race Conditions Between POST and Events**
   - Client posts message → server emits events
   - What if EventSource isn't connected when events are emitted?
   - Need event queuing/replay strategy

4. **Reconnection Edge Cases**
   - Human-in-the-loop approvals during disconnect
   - Event ordering guarantees
   - Last-Event-ID replay implementation

5. **Proxy Configuration**
   - nginx, Cloudflare, other proxies buffer by default
   - Need concrete configuration examples
   - Deployment complexity assessment

### Next Steps

- [ ] Validate current architecture understanding (Core → Server → WebUI flow)
- [ ] Research EventSource auth patterns in production systems
- [ ] Prototype SSE with real agent interactions
- [ ] Test proxy behavior with SSE
- [ ] Clarify error handling requirements
- [ ] Document concrete examples of race conditions
- [ ] Get feedback from potential API users

**Do not proceed with implementation until these issues are resolved.**

---

## 1. Motivation

### Current WebSocket Architecture

Today, Dexto uses WebSockets for bidirectional communication:

**Server → Client (Events):**
- Streaming LLM tokens (`llmservice:chunk`, `llmservice:thinking`)
- Tool execution lifecycle (`toolCall`, `toolResult`)
- Session updates (`conversationReset`, `sessionTitleUpdated`)
- Human-in-the-loop prompts (`dexto:approvalRequest`)
- MCP server notifications
- Resource updates

**Client → Server (Commands):**
- Send chat messages
- Approval responses (`approvalResponse`)
- Cancel operations
- Reset conversations

**Implementation:**
- `packages/server/src/hono/node/index.ts` - WebSocket server setup
- `packages/server/src/events/websocket-subscriber.ts` - Event broadcasting
- `AgentEventBus` emits domain events, `WebSocketEventSubscriber` broadcasts to clients

### Problems with Current Approach

1. **Infrastructure complexity**: WebSockets require special handling in proxies, load balancers, CDNs
2. **Hosting limitations**: Many serverless platforms have poor/no WebSocket support
3. **Debugging difficulty**: Can't use standard HTTP tooling (curl, Postman, browser DevTools network tab)
4. **Auth complexity**: WebSocket auth is ad-hoc vs. standard HTTP Bearer tokens
5. **Mental model mismatch**: Dexto's traffic pattern is fundamentally:
   - **Server→Client**: Streaming events (SSE's sweet spot)
   - **Client→Server**: Commands (REST's sweet spot)
6. **Gateway unfriendly**: Building an "AI gateway" or managed platform is harder with WebSockets

### Why SSE + REST is Better for Dexto

**Technical fit:**
- All server→client traffic is **event streams** (exactly what SSE does)
- All client→server traffic is **commands** (exactly what REST does)
- No need for arbitrary bidirectional channels or low-latency gaming-style interactions

**Operational benefits:**
- **One protocol**: Everything is HTTP
- **Standard tooling**: curl, fetch, browser DevTools all work
- **Better hosting**: Works everywhere (Vercel, Cloudflare Workers, AWS Lambda, etc.)
- **Simpler security**: Standard HTTP auth, CORS, rate limiting
- **Gateway ready**: Can build on top of standard API gateways

---

## 2. Goals & Non-Goals

### Goals

- Replace WebSocket with SSE for all server→client streaming
- Use REST for all client→server commands
- Maintain all existing functionality (streaming, HIL, cancellation, etc.)
- Provide cleaner API for library users and integrators
- Enable serverless deployment
- Simplify infrastructure and debugging

### Non-Goals

- No new features in this migration (just architectural change)
- No changes to core DextoAgent or business logic
- No changes to internal event bus architecture
- Not trying to support both WebSocket and SSE long-term (clean cutover)

---

## 3. High-Level Design

### Architecture Overview

**Before (WebSocket):**
```
┌─────────────┐     WebSocket      ┌──────────────┐
│   WebUI     │◄──────────────────►│    Server    │
│             │  bidirectional     │              │
└─────────────┘                    └──────────────┘
                                          │
                                   AgentEventBus
```

**After (SSE + REST):**
```
┌─────────────┐     GET /stream    ┌──────────────┐
│   WebUI     │◄───────────────────│    Server    │
│             │     SSE events     │              │
│             │                    │              │
│             │   POST /api/*      │              │
│             │────────────────────►              │
└─────────────┘     REST           └──────────────┘
                                          │
                                   AgentEventBus
```

### Key Principles

1. **Per-session SSE streams**: Each session has its own SSE endpoint
2. **Event-driven**: All updates flow as SSE events
3. **REST for mutations**: All commands are HTTP POST/PUT/DELETE
4. **Idempotent where possible**: Design endpoints to be safe for retries
5. **Reconnection-friendly**: Support `Last-Event-ID` for resume

---

## 4. New API Design

### 4.1 Session Management (Existing, Unchanged)

```bash
# Create session
POST /api/sessions
→ { sessionId: "abc", createdAt: "..." }

# List sessions
GET /api/sessions
→ { sessions: [...] }

# Delete session
DELETE /api/sessions/:sessionId
```

### 4.2 SSE Event Stream (New)

**Endpoint:**
```bash
GET /api/sessions/:sessionId/stream
```

**Query parameters:**
- `lastEventId` (optional): Resume from this event ID
- `timeout` (optional): Server timeout in ms (default: no timeout, long-lived)

**Headers:**
```
Accept: text/event-stream
Authorization: Bearer <token>
```

**Response:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: connected
data: {"sessionId":"abc","timestamp":"2025-01-05T..."}

event: thinking
data: {"sessionId":"abc"}

event: chunk
data: {"type":"token","content":"Hello","isComplete":false,"sessionId":"abc"}

event: chunk
data: {"type":"token","content":" world","isComplete":false,"sessionId":"abc"}

event: chunk
data: {"type":"token","content":"!","isComplete":true,"sessionId":"abc"}

event: toolCall
data: {"toolName":"search","args":{"query":"..."},"sessionId":"abc"}

event: toolResult
data: {"toolName":"search","result":"...","sessionId":"abc"}

event: approvalRequest
data: {"approvalId":"xyz","type":"tool_confirmation","toolName":"git_commit","args":{},"sessionId":"abc","timeout":120000}

event: response
data: {"content":"Here is your answer...","sessionId":"abc"}

event: error
data: {"message":"Tool execution failed","code":"TOOL_ERROR","sessionId":"abc"}
```

**Event types** (map 1:1 from current WebSocket events):
- `connected` - Initial connection confirmation
- `thinking` - Agent is processing
- `chunk` - Streaming content token
- `toolCall` - Tool is being called
- `toolResult` - Tool execution completed
- `approvalRequest` - Human-in-the-loop prompt
- `approvalResponse` - Approval was answered (broadcast to all listeners)
- `response` - Final response completed
- `error` - Error occurred
- `conversationReset` - Conversation was reset
- `sessionTitleUpdated` - Session title changed
- `mcpServerConnected`, `mcpServerDisconnected` - MCP events
- `resourceUpdated` - Resource changed

### 4.3 Message API (Modified)

**Send message:**
```bash
POST /api/sessions/:sessionId/messages
Content-Type: application/json

{
  "content": "Hello, agent!",
  "imageData": { ... },    // optional
  "fileData": { ... },      // optional
  "stream": true            // always implied for SSE
}

Response:
202 Accepted
{
  "ok": true,
  "messageId": "msg-123",
  "sessionId": "abc"
}
```

**Contract**: Client must have SSE stream open to receive events. No inline streaming in response body.

### 4.4 Control Commands (New/Modified)

**Cancel operation:**
```bash
POST /api/sessions/:sessionId/cancel
→ 200 OK { "ok": true }
```

**Reset conversation:**
```bash
POST /api/sessions/:sessionId/reset
→ 200 OK { "ok": true, "sessionId": "abc" }
```

**Approve/deny HIL request:**
```bash
POST /api/approvals/:approvalId
Content-Type: application/json

{
  "status": "approved",  // or "denied" or "cancelled"
  "data": {
    "rememberChoice": true  // optional
  }
}

Response:
200 OK { "ok": true, "approvalId": "xyz" }
```

### 4.5 Backward Compatibility Endpoint (Optional)

For simple use cases that don't need streaming:

```bash
POST /api/message-sync
Content-Type: application/json

{
  "content": "Hello",
  "sessionId": "abc"  // optional
}

Response:
200 OK
{
  "ok": true,
  "response": "Complete response text",
  "sessionId": "abc"
}
```

This blocks until completion (no streaming). Good for simple scripts/integrations.

---

## 5. Server Implementation Changes

### 5.1 Replace WebSocketEventSubscriber with SseEventSubscriber

**Current file**: `packages/server/src/events/websocket-subscriber.ts`

**New file**: `packages/server/src/events/sse-subscriber.ts`

```typescript
export class SseEventSubscriber {
  private sessions = new Map<string, Set<SseConnection>>();

  constructor(private agentEventBus: AgentEventBus) {
    this.subscribeToAgentEvents();
  }

  // Add a client connection for a specific session
  addConnection(sessionId: string, connection: SseConnection): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Set());
    }
    this.sessions.get(sessionId)!.add(connection);

    // Send initial connected event
    connection.send({
      event: 'connected',
      data: { sessionId, timestamp: new Date().toISOString() }
    });
  }

  removeConnection(sessionId: string, connection: SseConnection): void {
    this.sessions.get(sessionId)?.delete(connection);
  }

  private subscribeToAgentEvents(): void {
    // Map existing event bus events to SSE events
    this.agentEventBus.on('llmservice:thinking', (data) => {
      this.broadcast(data.sessionId, 'thinking', data);
    });

    this.agentEventBus.on('llmservice:chunk', (data) => {
      this.broadcast(data.sessionId, 'chunk', data);
    });

    this.agentEventBus.on('dexto:toolCall', (data) => {
      this.broadcast(data.sessionId, 'toolCall', data);
    });

    this.agentEventBus.on('dexto:toolResult', (data) => {
      this.broadcast(data.sessionId, 'toolResult', data);
    });

    this.agentEventBus.on('dexto:approvalRequest', (data) => {
      this.broadcast(data.sessionId, 'approvalRequest', data);
    });

    // ... map all other events
  }

  private broadcast(sessionId: string | undefined, event: string, data: unknown): void {
    const connections = sessionId
      ? this.sessions.get(sessionId)
      : this.getAllConnections();

    if (!connections) return;

    const message = {
      event,
      data: JSON.stringify(data)
    };

    for (const conn of connections) {
      try {
        conn.send(message);
      } catch (err) {
        logger.error(`Failed to send SSE message: ${err}`);
        this.removeConnection(sessionId!, conn);
      }
    }
  }
}
```

### 5.2 SSE Connection Abstraction

```typescript
// packages/server/src/events/sse-connection.ts
export class SseConnection {
  private eventId = 0;
  private closed = false;

  constructor(
    private response: Response,  // Hono response object
    private sessionId: string
  ) {
    this.setupConnection();
  }

  private setupConnection(): void {
    // Set SSE headers
    this.response.headers.set('Content-Type', 'text/event-stream');
    this.response.headers.set('Cache-Control', 'no-cache');
    this.response.headers.set('Connection', 'keep-alive');
    this.response.headers.set('X-Accel-Buffering', 'no'); // Disable nginx buffering
  }

  send(message: { event: string; data: string | object }): void {
    if (this.closed) return;

    const data = typeof message.data === 'string'
      ? message.data
      : JSON.stringify(message.data);

    // SSE format
    const payload = `event: ${message.event}\nid: ${++this.eventId}\ndata: ${data}\n\n`;

    try {
      this.response.write(payload);
    } catch (err) {
      this.closed = true;
      throw err;
    }
  }

  sendComment(comment: string): void {
    // Keep-alive via SSE comment
    if (!this.closed) {
      this.response.write(`: ${comment}\n\n`);
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.response.end();
    }
  }

  isClosed(): boolean {
    return this.closed;
  }
}
```

### 5.3 Hono Route Handler for SSE

```typescript
// packages/server/src/hono/routes/stream.ts
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

export function createStreamRouter(
  getAgent: () => DextoAgent,
  sseSubscriber: SseEventSubscriber
) {
  const app = new Hono();

  app.get('/sessions/:sessionId/stream', async (c) => {
    const sessionId = c.req.param('sessionId');
    const lastEventId = c.req.query('lastEventId');

    // Validate session exists
    const agent = getAgent();
    // TODO: validate session exists in agent

    return stream(c, async (stream) => {
      const connection = new SseConnection(stream, sessionId);

      sseSubscriber.addConnection(sessionId, connection);

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          connection.sendComment('keep-alive');
        } catch {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Wait until connection closes
      await stream.onAbort(() => {
        clearInterval(keepAlive);
        sseSubscriber.removeConnection(sessionId, connection);
        connection.close();
      });
    });
  });

  return app;
}
```

### 5.4 Update Message Handler

```typescript
// packages/server/src/hono/routes/messages.ts
app.post('/sessions/:sessionId/messages', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();

  const validation = validateBody(MessageRequestSchema, body);
  if (!validation.success) {
    return c.json(validation.response, 400);
  }

  const agent = getAgent();

  // Fire and forget - response comes via SSE
  agent.run(
    validation.data.content,
    validation.data.imageData,
    validation.data.fileData,
    sessionId,
    true // stream = true
  ).catch(err => {
    logger.error(`Message processing failed: ${err}`);
  });

  // Return immediately
  return c.json({
    ok: true,
    messageId: generateId(),
    sessionId
  }, 202);
});
```

### 5.5 Approval Endpoint

```typescript
// packages/server/src/hono/routes/approvals.ts
export function createApprovalsRouter(getAgent: () => DextoAgent) {
  const app = new Hono();

  app.post('/:approvalId', async (c) => {
    const approvalId = c.req.param('approvalId');
    const body = await c.req.json();

    const validation = ApprovalResponseSchema.safeParse(body);
    if (!validation.success) {
      return c.json({ ok: false, error: 'Invalid approval response' }, 400);
    }

    // Emit approval response on event bus
    // The ApprovalManager's handler is listening for this
    const agent = getAgent();
    agent.agentEventBus.emit('dexto:approvalResponse', {
      approvalId,
      ...validation.data
    });

    return c.json({ ok: true, approvalId });
  });

  return app;
}
```

### 5.6 Remove WebSocket Code

**Files to delete:**
- `packages/server/src/hono/node/index.ts` - WebSocket upgrade handling (lines 102-175)
- `packages/server/src/events/websocket-subscriber.ts` - Entire file
- `packages/server/src/events/websocket-error-handler.ts` - Entire file

**Files to modify:**
- `packages/server/src/hono/node/index.ts` - Remove WebSocket server creation
- `packages/server/src/hono/index.ts` - Remove WebSocket subscriber wiring

---

## 6. WebUI Implementation Changes

### 6.1 Replace WebSocket Client with SSE + REST

**Current**: `packages/webui/src/hooks/useWebSocket.ts` or similar

**New**: `packages/webui/src/hooks/useEventStream.ts`

```typescript
export function useEventStream(sessionId: string) {
  const [events, setEvents] = useState<Event[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${API_URL}/api/sessions/${sessionId}/stream`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      // Auto-reconnect handled by EventSource
    };

    // Register event handlers
    eventSource.addEventListener('connected', (e) => {
      console.log('Stream connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('thinking', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, { type: 'thinking', data }]);
    });

    eventSource.addEventListener('chunk', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, { type: 'chunk', data }]);
    });

    eventSource.addEventListener('toolCall', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, { type: 'toolCall', data }]);
    });

    eventSource.addEventListener('approvalRequest', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, { type: 'approvalRequest', data }]);
    });

    // ... register all event types

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  return { events, isConnected };
}
```

### 6.2 REST Client Utilities

```typescript
// packages/webui/src/api/client.ts
export async function sendMessage(
  sessionId: string,
  content: string,
  options?: { imageData?: any; fileData?: any }
) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      content,
      ...options
    })
  });

  if (!response.ok) {
    throw new Error('Failed to send message');
  }

  return response.json();
}

export async function cancelOperation(sessionId: string) {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  return response.json();
}

export async function respondToApproval(
  approvalId: string,
  status: 'approved' | 'denied',
  data?: { rememberChoice?: boolean }
) {
  const response = await fetch(`${API_URL}/api/approvals/${approvalId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({ status, data })
  });

  return response.json();
}
```

### 6.3 Updated Component Logic

```typescript
// packages/webui/src/components/ChatApp.tsx
export function ChatApp() {
  const { sessionId } = useSession();
  const { events, isConnected } = useEventStream(sessionId);
  const [messages, setMessages] = useState<Message[]>([]);

  // Process events into messages
  useEffect(() => {
    events.forEach(event => {
      switch (event.type) {
        case 'chunk':
          // Append token to current message
          setMessages(prev => appendChunk(prev, event.data));
          break;
        case 'toolCall':
          // Show tool execution
          setMessages(prev => [...prev, { type: 'tool', data: event.data }]);
          break;
        case 'approvalRequest':
          // Show approval UI
          showApprovalModal(event.data);
          break;
        // ... handle other events
      }
    });
  }, [events]);

  const handleSend = async (content: string) => {
    await sendMessage(sessionId, content);
    // Response will come via SSE events
  };

  const handleApprove = async (approvalId: string) => {
    await respondToApproval(approvalId, 'approved', { rememberChoice: true });
    closeApprovalModal();
  };

  return (
    <div>
      <ConnectionStatus connected={isConnected} />
      <MessageList messages={messages} />
      <InputArea onSend={handleSend} />
      {/* Approval modal renders based on events */}
    </div>
  );
}
```

---

## 7. Human-in-the-Loop Integration

### How HIL Works with SSE

**Flow:**

1. **Approval needed:**
   - `ToolManager` asks `ApprovalManager` for approval
   - `ApprovalManager` calls the handler (which is now SSE-based)

2. **Request broadcast:**
   - Handler emits `dexto:approvalRequest` on `AgentEventBus`
   - `SseEventSubscriber` sees the event, broadcasts to SSE clients
   - WebUI receives `approvalRequest` event on EventSource

3. **User responds:**
   - WebUI shows approval modal
   - User clicks "Approve" or "Deny"
   - WebUI POSTs to `/api/approvals/:approvalId`

4. **Response processed:**
   - Server receives POST, emits `dexto:approvalResponse` on event bus
   - Handler's promise resolves with the response
   - `ApprovalManager` returns result to `ToolManager`
   - Tool execution continues or is denied

**Implementation (Handler):**

```typescript
// packages/server/src/approval/sse-handler.ts
export function createSseApprovalHandler(
  eventBus: AgentEventBus,
  timeoutMs: number
): ApprovalHandler {
  const pending = new Map<string, {
    resolve: (res: ApprovalResponsePayload) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  // Listen for responses from REST endpoint
  eventBus.on('dexto:approvalResponse', (res: ApprovalResponsePayload) => {
    const entry = pending.get(res.approvalId);
    if (!entry) return;

    pending.delete(res.approvalId);
    clearTimeout(entry.timer);
    entry.resolve(res);
  });

  return (req: ApprovalRequestPayload) => {
    return new Promise<ApprovalResponsePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(req.approvalId);
        reject(new Error('Approval request timed out'));
      }, timeoutMs);

      pending.set(req.approvalId, { resolve, reject, timer });

      // Emit request - will be broadcast via SSE
      eventBus.emit('dexto:approvalRequest', req);
    });
  };
}
```

This is **identical to the WebSocket handler** from the HIL plan - the transport doesn't matter!

---

## 8. Rollout Plan

### Phase 1 - Server SSE Infrastructure (1-2 weeks)

**Goal:** Build SSE streaming without removing WebSocket yet

- [ ] Create `SseEventSubscriber` class
- [ ] Create `SseConnection` abstraction
- [ ] Add `/api/sessions/:sessionId/stream` endpoint
- [ ] Test SSE event broadcasting from AgentEventBus
- [ ] Implement keep-alive and reconnection handling
- [ ] Add SSE-based approval handler

**Deliverables:**
- SSE streaming works alongside WebSocket
- Can test SSE with curl or browser

### Phase 2 - New REST Endpoints (1 week)

**Goal:** Add REST endpoints for all commands

- [ ] Add `/api/sessions/:sessionId/messages` (POST)
- [ ] Add `/api/sessions/:sessionId/cancel` (POST)
- [ ] Add `/api/sessions/:sessionId/reset` (POST)
- [ ] Add `/api/approvals/:approvalId` (POST)
- [ ] Test all endpoints with Postman/curl
- [ ] Document new API

**Deliverables:**
- All command endpoints functional
- API documentation complete

### Phase 3 - WebUI Migration (2-3 weeks)

**Goal:** Update WebUI to use SSE + REST

- [ ] Create `useEventStream()` hook
- [ ] Create REST client functions
- [ ] Update ChatApp component
- [ ] Update approval flow
- [ ] Update session management
- [ ] Test reconnection scenarios
- [ ] Test with real agent interactions

**Deliverables:**
- WebUI works entirely with SSE + REST
- No WebSocket code in WebUI

### Phase 4 - Remove WebSocket (1 week)

**Goal:** Clean up WebSocket code from server

- [ ] Remove WebSocket upgrade handling
- [ ] Delete `WebSocketEventSubscriber`
- [ ] Delete `websocket-error-handler.ts`
- [ ] Update server initialization
- [ ] Remove WebSocket dependencies from package.json
- [ ] Update all documentation

**Deliverables:**
- WebSocket code completely removed
- Server is HTTP-only

### Phase 5 - Testing & Polish (1 week)

**Goal:** Ensure production readiness

- [ ] Load testing with multiple concurrent streams
- [ ] Test reconnection edge cases
- [ ] Test approval flow under network issues
- [ ] Performance comparison (latency, memory)
- [ ] Update deployment docs
- [ ] Create migration guide

**Deliverables:**
- Production-ready SSE + REST API
- Complete documentation

---

## 9. Migration Guide for Users

### For WebSocket API Users

**Old WebSocket API:**
```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.onmessage = (msg) => {
  const { event, data } = JSON.parse(msg.data);

  if (event === 'chunk') {
    console.log(data.content);
  }
};

ws.send(JSON.stringify({
  type: 'message',
  content: 'Hello',
  sessionId: 'abc'
}));
```

**New SSE + REST API:**
```javascript
// Open SSE stream
const eventSource = new EventSource('http://localhost:3001/api/sessions/abc/stream');

eventSource.addEventListener('chunk', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.content);
});

// Send message via REST
await fetch('http://localhost:3001/api/sessions/abc/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Hello' })
});
```

### Breaking Changes

1. **No more bidirectional WebSocket** - Use SSE for events, REST for commands
2. **New endpoint structure** - `/api/sessions/:id/stream` instead of WS upgrade
3. **Approval responses** - POST to `/api/approvals/:id` instead of WebSocket message
4. **Message format** - SSE uses `event` + `data` fields, not wrapped JSON

### Migration Checklist

- [ ] Replace WebSocket connection with EventSource
- [ ] Update message sending to use REST POST
- [ ] Update approval handling to use REST POST
- [ ] Add reconnection logic for SSE
- [ ] Update error handling (HTTP status codes)
- [ ] Test with production traffic

---

## 10. Technical Considerations

### 10.1 Reconnection Strategy

**EventSource has built-in reconnection:**
- Automatically reconnects on disconnect
- Sends `Last-Event-ID` header on reconnect
- Server can use this to replay missed events (optional)

**Implementation:**
```typescript
// Server: Store last N events per session for replay
class SseEventSubscriber {
  private eventHistory = new Map<string, CircularBuffer<SseEvent>>();

  addConnection(sessionId: string, connection: SseConnection, lastEventId?: string): void {
    // Replay events after lastEventId
    if (lastEventId) {
      const history = this.eventHistory.get(sessionId);
      const missedEvents = history?.getEventsSince(lastEventId) ?? [];
      missedEvents.forEach(event => connection.send(event));
    }
  }
}
```

### 10.2 Connection Limits

**Browser limits:**
- ~6 concurrent EventSource connections per domain
- Not an issue for Dexto (typically 1 stream per session)

**Server limits:**
- SSE is more efficient than WebSocket (no upgrade overhead)
- Can handle 1000s of concurrent connections per server

### 10.3 Backpressure

**SSE is text-based:**
- No built-in backpressure mechanism
- Not an issue for Dexto (small JSON events, not binary streams)

**If needed, can implement:**
```typescript
class SseConnection {
  private buffer: SseEvent[] = [];
  private paused = false;

  send(event: SseEvent): void {
    if (this.paused) {
      this.buffer.push(event);
      return;
    }

    try {
      this.response.write(formatSseEvent(event));
    } catch (err) {
      this.paused = true;
      this.buffer.push(event);
      // Retry later
    }
  }
}
```

### 10.4 Keep-Alive

**SSE requires keep-alive to prevent timeout:**
- Send comment lines every 15-30 seconds
- `: keep-alive\n\n`
- Prevents proxies from closing idle connections

**Implementation:**
```typescript
const keepAlive = setInterval(() => {
  connection.sendComment('keep-alive');
}, 30000);
```

### 10.5 CORS

**SSE requires explicit CORS:**
```typescript
app.get('/api/sessions/:id/stream', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Credentials', 'true');
  // ... SSE headers
});
```

---

## 11. Benefits Summary

### Operational

- ✅ **Simplified infrastructure**: No WebSocket-aware proxies/load balancers
- ✅ **Universal hosting**: Works on Vercel, Cloudflare, Lambda, etc.
- ✅ **Standard debugging**: curl, Postman, browser DevTools
- ✅ **Gateway-ready**: Can build on API gateways (Kong, AWS API Gateway, etc.)

### Development

- ✅ **Cleaner mental model**: REST for commands, SSE for events
- ✅ **Better DX for integrators**: Standard HTTP, not custom WebSocket protocol
- ✅ **Easier testing**: Can test endpoints independently
- ✅ **Built-in reconnection**: EventSource handles it automatically

### Architecture

- ✅ **Single protocol**: Everything is HTTP
- ✅ **Better fit**: Matches Dexto's actual traffic patterns
- ✅ **Stateless**: Servers don't need to maintain WebSocket state
- ✅ **Scalability**: Easier to load balance and scale

---

## 12. Open Questions

1. **Event replay**: Should we implement `Last-Event-ID` replay or just require clients to refetch state?
2. **Multi-session streams**: Should we support a global stream (`/api/stream`) or only per-session?
3. **Sync endpoint**: Keep the sync endpoint (`/api/message-sync`) for simple use cases?
4. **Binary data**: How to handle large binary responses (file downloads)? Separate REST endpoint?
5. **Authentication**: Keep Bearer tokens in headers or support query param for EventSource compatibility?

---

## 13. Success Criteria

### Functional

- [ ] All existing features work (streaming, HIL, cancellation, etc.)
- [ ] WebUI has feature parity with WebSocket version
- [ ] Library users can integrate via standard HTTP
- [ ] Approval flow works reliably over SSE + REST

### Performance

- [ ] Latency similar to WebSocket (<50ms overhead)
- [ ] Memory usage similar or lower
- [ ] Can handle 100+ concurrent sessions per server
- [ ] Reconnection works smoothly (no lost events)

### Documentation

- [ ] API reference for all endpoints
- [ ] Migration guide for existing users
- [ ] Integration examples (curl, fetch, libraries)
- [ ] Deployment guide for various platforms

---

## 14. Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 1-2 weeks | SSE infrastructure |
| Phase 2 | 1 week | REST endpoints |
| Phase 3 | 2-3 weeks | WebUI migration |
| Phase 4 | 1 week | Remove WebSocket |
| Phase 5 | 1 week | Testing & polish |

**Total: 6-8 weeks**

---

## 15. Risks & Mitigations

### Risk: SSE browser compatibility

**Mitigation**: EventSource is supported in all modern browsers. For IE11, use polyfill.

### Risk: Connection limits

**Mitigation**: 6 connections per domain is enough for typical use (1 stream per session).

### Risk: Lost events during reconnection

**Mitigation**: Implement `Last-Event-ID` replay or require clients to refetch critical state.

### Risk: Proxy buffering

**Mitigation**: Send keep-alive comments, set `X-Accel-Buffering: no` header.

### Risk: Performance degradation

**Mitigation**: Benchmark before/after. SSE should be equal or better (less overhead).

---

## Conclusion

Moving from WebSockets to SSE + REST is a significant but worthwhile architectural change for Dexto. It simplifies infrastructure, improves hosting flexibility, and provides a cleaner API that matches the actual traffic patterns. The migration is straightforward with a clear phased approach, and the benefits compound as Dexto grows into a managed platform.
