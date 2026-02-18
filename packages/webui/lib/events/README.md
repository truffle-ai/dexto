# Event System

Centralized event dispatch system for the Dexto WebUI.

## Architecture

```
SSE Stream → EventBus → Middleware → Handlers → Zustand Stores → React Components
```

### Components

1. **EventBus** (`EventBus.ts`) - Central event dispatcher
   - Manages event subscriptions
   - Executes middleware pipeline
   - Maintains event history for debugging

2. **Handlers** (`handlers.ts`) - Event-to-store mapping
   - Registry of handlers by event name
   - Each handler updates appropriate Zustand stores
   - Simple, focused functions with minimal logic

3. **Middleware** (`middleware/`) - Cross-cutting concerns
   - Logging middleware for debugging
   - Extensible for analytics, notifications, etc.

4. **Types** (`types.ts`) - TypeScript definitions
   - Re-exports StreamingEvent from @dexto/core
   - Client-only events (connection status, etc.)

## Usage

### Setting Up Event Handlers

In your app initialization or EventBusProvider:

```typescript
import { useEventBus } from '@/components/providers/EventBusProvider';
import { setupEventHandlers } from '@/lib/events';

function MyApp() {
  const bus = useEventBus();

  useEffect(() => {
    const cleanup = setupEventHandlers(bus);
    return cleanup;
  }, [bus]);

  return <YourComponents />;
}
```

### Dispatching Events

Events are automatically dispatched from the SSE stream. For testing or manual dispatch:

```typescript
import { eventBus } from '@/lib/events';

eventBus.dispatch({
  name: 'llm:chunk',
  sessionId: 'session-123',
  content: 'Hello',
  chunkType: 'text',
});
```

### Subscribing to Events

For custom logic beyond the default handlers:

```typescript
import { useEventBus } from '@/components/providers/EventBusProvider';

function MyComponent() {
  const bus = useEventBus();

  useEffect(() => {
    const subscription = bus.on('llm:response', (event) => {
      console.log('Response received:', event.content);
    });

    return () => subscription.unsubscribe();
  }, [bus]);
}
```

## Event Handlers

Each handler corresponds to a StreamingEvent type from `@dexto/core`:

| Event | Handler | Store Updates |
|-------|---------|---------------|
| `llm:thinking` | `handleLLMThinking` | chatStore (processing=true), agentStore (status='thinking') |
| `llm:chunk` | `handleLLMChunk` | chatStore (append to streaming message) |
| `llm:response` | `handleLLMResponse` | chatStore (finalize message with metadata) |
| `llm:tool-call` | `handleToolCall` | chatStore (add tool message), agentStore (status='executing_tool') |
| `llm:tool-result` | `handleToolResult` | chatStore (update tool message with result) |
| `llm:error` | `handleLLMError` | chatStore (set error, processing=false), agentStore (status='idle') |
| `approval:request` | `handleApprovalRequest` | agentStore (status='awaiting_approval') |
| `approval:response` | `handleApprovalResponse` | agentStore (status='idle') |
| `run:complete` | `handleRunComplete` | chatStore (processing=false), agentStore (status='idle') |
| `session:title-updated` | `handleSessionTitleUpdated` | (handled by TanStack Query) |
| `message:dequeued` | `handleMessageDequeued` | chatStore (add user message from queue) |
| `context:compressed` | `handleContextCompressed` | (log for debugging) |

## Adding New Handlers

1. Define the handler function in `handlers.ts`:

```typescript
function handleMyNewEvent(event: EventByName<'my:event'>): void {
  const { sessionId, data } = event;
  // Update stores as needed
  useSomeStore.getState().updateSomething(sessionId, data);
}
```

2. Register in `registerHandlers()`:

```typescript
export function registerHandlers(): void {
  // ... existing handlers
  handlers.set('my:event', handleMyNewEvent);
}
```

3. Add tests in `handlers.test.ts`:

```typescript
describe('handleMyNewEvent', () => {
  it('should update the store correctly', () => {
    const event = {
      name: 'my:event' as const,
      sessionId: TEST_SESSION_ID,
      data: 'test',
    };

    handleMyNewEvent(event);

    const state = useSomeStore.getState();
    expect(state.data).toBe('test');
  });
});
```

## Testing

Run tests:

```bash
bun run test:unit -- packages/webui/lib/events/handlers.test.ts
```

Each handler is tested in isolation to verify correct store updates.

## Design Principles

1. **Handler simplicity** - Handlers extract data from events and call store actions. No complex logic.

2. **Store-driven** - All state changes go through Zustand stores. Handlers don't mutate state directly.

3. **Type safety** - Events are strongly typed via StreamingEvent union from @dexto/core.

4. **Testability** - Each handler can be tested independently with mocked stores.

5. **Single responsibility** - One handler per event type, focused on one concern.

## Migration from useChat

The handler registry replaces the 200+ LOC switch statement in `useChat.ts`:

**Before:**
```typescript
// In useChat.ts
switch (event.name) {
  case 'llm:thinking':
    setProcessing(true);
    // ... more logic
    break;
  case 'llm:chunk':
    // ... 30+ lines
    break;
  // ... 10+ more cases
}
```

**After:**
```typescript
// In handlers.ts
function handleLLMThinking(event) {
  useChatStore.getState().setProcessing(event.sessionId, true);
  useAgentStore.getState().setThinking(event.sessionId);
}

function handleLLMChunk(event) {
  // Simple, focused logic
}

// Register all handlers
registerHandlers();
```

This provides:
- Better testability (test each handler independently)
- Clearer separation of concerns
- Easier to add/modify handlers
- Type safety with EventByName helper
