# WebUI State Management Architecture

## Hybrid Context + Zustand Approach

The WebUI uses a **hybrid architecture** combining React Context and Zustand stores. This isn't redundant—each serves a distinct purpose.

## Why Zustand?

### The Key Reason: Event Handlers Run Outside React

```typescript
// Event handlers are plain functions, not React components
function handleLLMThinking(event: EventByName<'llm:thinking'>): void {
    const { sessionId } = event;

    // ✅ Imperative access - works outside React
    useChatStore.getState().setProcessing(sessionId, true);
    useAgentStore.getState().setThinking(sessionId);
}
```

**Event handlers can't use React hooks.** They need imperative state access from outside the component tree. Zustand provides this through `.getState()`.

With React Context, you'd need hacky global variables or complex callback registration—exactly what Zustand does, but type-safe and battle-tested.

### Secondary Benefits

1. **Granular subscriptions** - Components only re-render when their specific slice changes
2. **Multi-session state** - Efficient Map-based per-session storage
3. **No provider hell** - No need for nested provider components
4. **DevTools** - Time-travel debugging and state inspection

## Architecture Pattern

```
┌─────────────────────────────────────────┐
│ React Components                        │
│  - Use ChatContext for actions          │
│  - Use Zustand stores for state         │
└────────────┬────────────────────────────┘
             │
      ┌──────┴──────┐
      ▼             ▼
┌──────────┐  ┌──────────┐
│ Context  │  │ Zustand  │
│          │  │          │
│ Actions  │  │  State   │
│ Hooks    │  │          │
│ Query    │  │  Pure    │
└──────────┘  └────┬─────┘
                   ▲
                   │
          ┌────────┴────────┐
          │ Event Handlers   │
          │ (outside React)  │
          └─────────────────┘
```

## When to Use What

### Use Zustand Stores For:
- ✅ State that needs access from **outside React** (event handlers, middleware)
- ✅ **Per-session state** (messages, errors, processing)
- ✅ **High-frequency updates** (streaming, real-time events)
- ✅ State accessed by **many components** (current session, notifications)

**Examples**: `chatStore`, `sessionStore`, `approvalStore`, `notificationStore`, `agentStore`

### Use React Context For:
- ✅ **React-specific orchestration** (combining hooks, effects, callbacks)
- ✅ **API integration** (TanStack Query, mutations)
- ✅ **Lifecycle management** (connection setup, cleanup)
- ✅ **Derived state** that depends on multiple sources

**Examples**: `ChatContext`, `EventBusProvider`

## Store Organization

```
lib/stores/
├── README.md                    # This file
├── index.ts                     # Barrel exports
├── chatStore.ts                 # Per-session messages, streaming, errors
├── sessionStore.ts              # Current session, navigation state
├── approvalStore.ts             # Approval requests with queueing
├── notificationStore.ts         # Toast notifications
├── agentStore.ts                # Agent status, connection, heartbeat
└── eventLogStore.ts             # Event history for debugging
```

## Usage Patterns

### Reading State in Components

```typescript
import { useChatStore } from '@/lib/stores/chatStore';
import { useSessionStore } from '@/lib/stores/sessionStore';

function ChatApp() {
    // Granular subscription - only re-renders when messages change
    const messages = useChatStore((s) => {
        if (!currentSessionId) return EMPTY_MESSAGES;
        const session = s.sessions.get(currentSessionId);
        return session?.messages ?? EMPTY_MESSAGES;
    });

    // Simple value access
    const currentSessionId = useSessionStore((s) => s.currentSessionId);

    // ...
}
```

### Updating State from Event Handlers

```typescript
import { useChatStore } from '@/lib/stores/chatStore';
import { useAgentStore } from '@/lib/stores/agentStore';

function handleLLMChunk(event: EventByName<'llm:chunk'>): void {
    const { sessionId, content, chunkType } = event;

    // Imperative access from outside React
    const chatStore = useChatStore.getState();
    chatStore.appendToStreamingMessage(sessionId, content, chunkType);
}
```

### Updating State from Context/Components

```typescript
// In ChatContext or components with hooks
const setProcessing = useCallback((sessionId: string, isProcessing: boolean) => {
    useChatStore.getState().setProcessing(sessionId, isProcessing);
}, []);
```

## Event Flow

```
SSE Stream (server)
    ↓
useChat.ts (line 219)
    ↓
eventBus.dispatch(event)
    ↓
Middleware Pipeline (logging, activity, notifications)
    ↓
Event Handlers (handlers.ts)
    ↓
Zustand Stores (.getState() imperative updates)
    ↓
React Components (via selectors, triggers re-render)
```

## Best Practices

### 1. Use Stable References for Empty Arrays

```typescript
// ✅ DO: Prevents infinite re-render loops
const EMPTY_MESSAGES: Message[] = [];

const messages = useChatStore((s) => {
    if (!currentSessionId) return EMPTY_MESSAGES;
    return s.sessions.get(currentSessionId)?.messages ?? EMPTY_MESSAGES;
});

// ❌ DON'T: Creates new array reference on every render
const messages = useChatStore((s) => {
    if (!currentSessionId) return []; // New reference each time!
    return s.sessions.get(currentSessionId)?.messages ?? [];
});
```

### 2. Selector Efficiency

```typescript
// ✅ DO: Narrow selectors for specific data
const processing = useChatStore((s) => {
    const session = s.sessions.get(currentSessionId);
    return session?.processing ?? false;
});

// ❌ DON'T: Selecting entire store triggers unnecessary re-renders
const store = useChatStore(); // Re-renders on any store change!
const processing = store.sessions.get(currentSessionId)?.processing;
```

### 3. Imperative vs Hook Usage

```typescript
// ✅ In React components - use hook
function MyComponent() {
    const messages = useChatStore((s) => s.getMessages(sessionId));
    // ...
}

// ✅ In event handlers - use .getState()
function handleEvent(event) {
    useChatStore.getState().addMessage(sessionId, message);
}

// ❌ DON'T: Use hooks outside React
function handleEvent(event) {
    const store = useChatStore(); // ❌ Can't use hooks here!
}
```

## Testing

All stores have comprehensive test coverage. See `*.test.ts` files for examples:

```typescript
import { useChatStore } from './chatStore';

describe('chatStore', () => {
    beforeEach(() => {
        useChatStore.setState({ sessions: new Map() });
    });

    it('should add message to session', () => {
        const store = useChatStore.getState();
        store.addMessage('session-1', { id: 'msg-1', ... });

        const messages = store.getMessages('session-1');
        expect(messages).toHaveLength(1);
    });
});
```

## Related Documentation

- Event system: `packages/webui/lib/events/README.md`
- Event handlers: `packages/webui/lib/events/handlers.ts`
- Event middleware: `packages/webui/lib/events/middleware/`
- Main architecture: `/docs` (to be updated)
