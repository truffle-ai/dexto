# EventBus Usage Guide

Complete integration guide for the EventBus system with SSE event dispatching.

## Architecture

```
SSE Stream → useEventDispatch → EventBus → Middleware → Handlers → Stores → UI Updates
```

## Setup

### 1. Wrap App with EventBusProvider

```tsx
// app/root.tsx or similar
import { EventBusProvider } from '@/components/providers/EventBusProvider';

export default function App() {
    return (
        <EventBusProvider
            enableLogging={true}           // Console logging (dev only by default)
            enableActivityLogging={true}   // Event log store
            enableNotifications={true}     // Toast notifications
        >
            <YourApp />
        </EventBusProvider>
    );
}
```

The provider automatically:
- Registers middleware (logging, activity, notifications)
- Sets up event handlers to dispatch to stores
- Cleans up on unmount

### 2. Dispatch SSE Events

In your message streaming component:

```tsx
import { createMessageStream } from '@dexto/client-sdk';
import { useEventDispatch } from '@/lib/events';
import { client } from '@/lib/client';

export function useMessageStream(sessionId: string) {
    const { dispatchEvent } = useEventDispatch();

    const sendMessage = async (message: string) => {
        const responsePromise = client.api['message-stream'].$post({
            json: { message, sessionId }
        });

        const stream = createMessageStream(responsePromise);

        for await (const event of stream) {
            // Dispatch to EventBus - handlers will update stores
            dispatchEvent(event);
        }
    };

    return { sendMessage };
}
```

### 3. Components React to Store Updates

Components subscribe to stores as usual:

```tsx
import { useChatStore } from '@/lib/stores/chatStore';
import { useAgentStore } from '@/lib/stores/agentStore';

export function ChatInterface({ sessionId }: { sessionId: string }) {
    // Get session state
    const sessionState = useChatStore(state =>
        state.getSessionState(sessionId)
    );

    // Get agent status
    const agentStatus = useAgentStore(state => state.status);

    return (
        <div>
            {sessionState.streamingMessage && (
                <StreamingMessage message={sessionState.streamingMessage} />
            )}

            {sessionState.messages.map(msg => (
                <Message key={msg.id} message={msg} />
            ))}

            {agentStatus === 'thinking' && <ThinkingIndicator />}
        </div>
    );
}
```

## Event Flow Examples

### Example 1: LLM Response

```
1. SSE: llm:thinking
   → Handler: handleLLMThinking
   → Store: agentStore.setThinking(sessionId)
   → Store: chatStore.setProcessing(sessionId, true)
   → UI: Show thinking indicator

2. SSE: llm:chunk (content: "Hello")
   → Handler: handleLLMChunk
   → Store: chatStore.setStreamingMessage(sessionId, newMessage)
   → UI: Show streaming message

3. SSE: llm:chunk (content: " world")
   → Handler: handleLLMChunk
   → Store: chatStore.appendToStreamingMessage(sessionId, " world")
   → UI: Update streaming message

4. SSE: llm:response (tokenUsage, model)
   → Handler: handleLLMResponse
   → Store: chatStore.finalizeStreamingMessage(sessionId, metadata)
   → UI: Move to messages array, show token count

5. SSE: run:complete
   → Handler: handleRunComplete
   → Store: agentStore.setIdle()
   → Store: chatStore.setProcessing(sessionId, false)
   → UI: Hide thinking indicator
```

### Example 2: Tool Call

```
1. SSE: llm:tool-call (toolName: "read_file", callId: "123")
   → Handler: handleToolCall
   → Store: chatStore.addMessage(sessionId, toolMessage)
   → Store: agentStore.setExecutingTool(sessionId, "read_file")
   → UI: Show tool message, show executing indicator

2. SSE: llm:tool-result (callId: "123", success: true, sanitized: "File contents")
   → Handler: handleToolResult
   → Store: chatStore.updateMessage(sessionId, messageId, { toolResult, success })
   → UI: Update tool message with result
```

### Example 3: Approval Request

```
1. SSE: approval:request (type: TOOL_CONFIRMATION, toolName: "write_file")
   → Handler: handleApprovalRequest
   → Store: agentStore.setAwaitingApproval(sessionId)
   → Middleware (notification): Show toast "Tool write_file needs approval"
   → UI: Show approval dialog

2. User clicks "Approve"
   → API: POST /api/approval/respond { status: "approved" }

3. SSE: approval:response (status: "approved")
   → Handler: handleApprovalResponse
   → Store: agentStore.setIdle()
   → UI: Hide approval dialog, resume processing
```

## Middleware

### Logging Middleware

Logs all events to console (dev mode only by default):

```
[EventBus] llm:thinking → sessionId: abc-123
[EventBus] llm:chunk → sessionId: abc-123, chunkType: text, content: Hello
```

### Activity Middleware

Logs events to EventLogStore for debugging panel:

```tsx
import { useEventLogStore } from '@/lib/stores/eventLogStore';

export function DebugPanel() {
    const events = useEventLogStore(state => state.events);

    return (
        <div>
            {events.map(event => (
                <div key={event.id}>
                    {event.timestamp} - {event.category} - {event.description}
                </div>
            ))}
        </div>
    );
}
```

### Notification Middleware

Shows toast notifications for important events:

- `approval:request` → "Tool X needs your approval"
- `llm:error` → Error message with recovery info
- Session-aware: Only notifies for current session

## Testing

### Unit Test - Individual Handler

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ClientEventBus } from './EventBus';
import { handleLLMChunk } from './handlers';
import { useChatStore } from '../stores/chatStore';

describe('handleLLMChunk', () => {
    beforeEach(() => {
        useChatStore.setState({ sessions: new Map() });
    });

    it('should create streaming message on first chunk', () => {
        handleLLMChunk({
            name: 'llm:chunk',
            sessionId: 'test',
            content: 'Hello',
            chunkType: 'text',
        });

        const state = useChatStore.getState().getSessionState('test');
        expect(state.streamingMessage?.content).toBe('Hello');
    });
});
```

### Integration Test - Full Flow

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClientEventBus } from './EventBus';
import { setupEventHandlers } from './handlers';
import { useChatStore } from '../stores/chatStore';
import { useAgentStore } from '../stores/agentStore';

describe('EventBus Integration', () => {
    let bus: ClientEventBus;
    let cleanup: () => void;

    beforeEach(() => {
        bus = new ClientEventBus();
        cleanup = setupEventHandlers(bus);

        // Reset stores
        useChatStore.setState({ sessions: new Map() });
        useAgentStore.setState({ status: 'idle', /* ... */ });
    });

    afterEach(() => {
        cleanup();
    });

    it('should handle full LLM response flow', () => {
        // Thinking
        bus.dispatch({ name: 'llm:thinking', sessionId: 'test' });
        expect(useAgentStore.getState().status).toBe('thinking');

        // Chunk
        bus.dispatch({
            name: 'llm:chunk',
            sessionId: 'test',
            content: 'Response',
            chunkType: 'text',
        });
        expect(useChatStore.getState().getSessionState('test').streamingMessage)
            .not.toBeNull();

        // Complete
        bus.dispatch({
            name: 'llm:response',
            sessionId: 'test',
            tokenUsage: { totalTokens: 100 },
        });
        expect(useChatStore.getState().getSessionState('test').messages)
            .toHaveLength(1);
    });
});
```

## Custom Middleware

Create custom middleware to extend functionality:

```typescript
import type { EventMiddleware } from '@/lib/events';

export const analyticsMiddleware: EventMiddleware = (event, next) => {
    // Track analytics
    if (event.name === 'llm:response') {
        analytics.track('llm_response', {
            sessionId: event.sessionId,
            model: event.model,
            tokens: event.tokenUsage?.totalTokens,
        });
    }

    return next(event);
};

// Use it
<EventBusProvider middleware={[analyticsMiddleware]}>
    <App />
</EventBusProvider>
```

## Advanced: Direct Bus Access

For cases where you need direct access to the bus:

```tsx
import { useEventBus } from '@/components/providers/EventBusProvider';

export function CustomComponent() {
    const bus = useEventBus();

    useEffect(() => {
        // Subscribe to specific event
        const sub = bus.on('llm:error', (event) => {
            console.error('LLM Error:', event.error);
        });

        return () => sub.unsubscribe();
    }, [bus]);

    // Dispatch custom event
    const handleAction = () => {
        bus.dispatch({
            name: 'custom:event',
            sessionId: 'test',
            // ... custom data
        });
    };
}
```

## Summary

1. **EventBusProvider** - Wrap your app, registers middleware and handlers
2. **useEventDispatch** - Use in components to dispatch SSE events
3. **Middleware** - Intercepts events (logging, activity, notifications)
4. **Handlers** - Process events and update stores
5. **Stores** - Hold state, trigger React re-renders
6. **Components** - Subscribe to stores, render UI

All wired together automatically. Just dispatch events and let the system handle the rest.
