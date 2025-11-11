# Ink CLI Architecture Documentation

## Overview

This document describes the refactored Ink CLI architecture, which transforms a monolithic 1150-line component into a well-structured, maintainable system.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     InkCLIRefactored.tsx                     │
│                    (Orchestrator ~150 lines)                 │
│                                                              │
│  - Initializes state with useReducer                        │
│  - Creates service instances                                │
│  - Sets up custom hooks                                     │
│  - Renders components                                       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐     ┌──────────────┐
│   State      │    │   Hooks      │     │  Services    │
│  Management  │    │              │     │              │
├──────────────┤    ├──────────────┤     ├──────────────┤
│ • types.ts   │    │ • useAgent   │     │ • Command    │
│ • actions.ts │    │   Events     │     │   Service    │
│ • reducer.ts │    │ • useInput   │     │ • Message    │
│ • initial    │    │   History    │     │   Service    │
│   State.ts   │    │ • useOverlay │     │ • Input      │
└──────────────┘    │   Manager    │     │   Service    │
                    │ • useKeyboard│     └──────────────┘
                    │   Shortcuts  │
                    │ • useSession │
                    │   Sync       │
                    └──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐   ┌──────────────┐
│  Containers  │    │ Presentational│   │  Base        │
│              │    │  Components   │   │  Components  │
├──────────────┤    ├──────────────┤   ├──────────────┤
│ • Input      │    │ • ChatView   │   │ • Base       │
│   Container  │    │ • MessageList│   │   Selector   │
│ • Overlay    │    │ • MessageItem│   │ • Base       │
│   Container  │    │ • Header     │   │   Autocomplete│
└──────────────┘    │ • Footer     │   └──────────────┘
                    │ • InputArea  │
                    └──────────────┘
```

## Key Components

### 1. State Management (`state/`)

**Single Source of Truth**

All application state is managed through a reducer pattern:

```typescript
interface CLIState {
    messages: Message[];
    streamingMessage: StreamingMessage | null;
    input: InputState;
    ui: UIState;
    session: SessionState;
    approval: ApprovalRequest | null;
}
```

**Benefits:**
- Predictable state transitions
- Easy to debug (action log)
- Testable (pure reducer function)
- Better performance (batched updates)
- Type-safe actions

### 2. Custom Hooks (`hooks/`)

**Reusable Logic**

Each hook has a single, clear responsibility:

- `useAgentEvents` - Transforms event bus events into state actions
- `useInputHistory` - Handles arrow key navigation through history
- `useOverlayManager` - Manages overlay visibility state
- `useKeyboardShortcuts` - Global shortcuts (Ctrl+C, Esc)
- `useSessionSync` - Synchronizes session state with agent

**Benefits:**
- Testable in isolation
- Reusable across components
- Clear separation of concerns
- Easy to understand

### 3. Services (`services/`)

**Business Logic Layer**

Services contain no UI logic:

- `CommandService` - Parses and executes commands
- `MessageService` - Creates and formats messages
- `InputService` - Detects input patterns and manipulates text

**Benefits:**
- Reusable across different interfaces
- Easy to test (no UI dependencies)
- Clear API boundaries
- Single responsibility

### 4. Presentational Components (`components/`)

**Pure Display Logic**

Components receive data as props and render UI:

- `ChatView` - Combines header and message list
- `MessageList` - Renders list of messages
- `MessageItem` - Single message display
- `Header` - CLI branding and info
- `Footer` - Keyboard shortcuts
- `InputArea` - Input display

**Benefits:**
- Easy to test (snapshot testing)
- Reusable in different contexts
- No side effects
- Performance optimized with memo

### 5. Base Components (`components/base/`)

**Reusable Generic Components**

Generic components that eliminate duplication:

- `BaseSelector<T>` - Generic selector with keyboard nav and scrolling
- `BaseAutocomplete<T>` - Generic autocomplete with filtering and scoring

**Benefits:**
- Eliminates ~500 lines of duplicated code
- Type-safe with generics
- Consistent UX
- Single place to fix bugs

### 6. Smart Containers (`containers/`)

**Orchestration Layer**

Containers connect state, services, and components:

- `InputContainer` - Manages input submission and command execution
- `OverlayContainer` - Manages all overlays (selectors, autocomplete, approval)

**Benefits:**
- Clear separation: smart (containers) vs dumb (presentational)
- Easier to refactor
- Testable integration points

## Data Flow

### User Input Flow

```
User types
    ↓
InputArea (presentational)
    ↓
InputContainer (smart)
    ↓
dispatch(INPUT_CHANGE)
    ↓
Reducer updates state
    ↓
Components re-render with new state
```

### Message Submission Flow

```
User presses Enter
    ↓
InputContainer.handleSubmit()
    ↓
CommandService.executeCommand()
  or agent.run()
    ↓
dispatch(SUBMIT_START)
    ↓
Reducer updates state (adds user message, clears input)
    ↓
Agent processes (if prompt)
    ↓
Event bus events
    ↓
useAgentEvents hook
    ↓
dispatch(STREAMING_CHUNK/END)
    ↓
Reducer updates state
    ↓
Components re-render
```

### Overlay Management Flow

```
User types "/" or "@"
    ↓
InputService.detectAutocompleteType()
    ↓
OverlayContainer effect
    ↓
dispatch(SHOW_OVERLAY)
    ↓
Reducer updates state
    ↓
OverlayContainer renders appropriate overlay
```

## Design Patterns

### 1. Reducer Pattern
- **What**: State + Action → New State
- **Why**: Predictable, testable state transitions
- **Where**: `state/reducer.ts`

### 2. Service Layer Pattern
- **What**: Business logic separated from UI
- **Why**: Reusable, testable, clear boundaries
- **Where**: `services/`

### 3. Container/Presentational Pattern
- **What**: Smart components (logic) vs dumb components (display)
- **Why**: Separation of concerns, easier testing
- **Where**: `containers/` vs `components/`

### 4. Generic Components Pattern
- **What**: Reusable components with type parameters
- **Why**: Eliminate duplication, type-safe
- **Where**: `components/base/`

### 5. Custom Hooks Pattern
- **What**: Extract reusable logic into hooks
- **Why**: Share logic across components, testable
- **Where**: `hooks/`

### 6. Event Adapter Pattern
- **What**: Transform external events into internal actions
- **Why**: Decouple event bus from UI
- **Where**: `useAgentEvents` hook

## Performance Optimizations

1. **Memoization**
   - Services created once with `useMemo`
   - Visible messages calculated with `useMemo`
   - MessageItem wrapped in `memo`

2. **Limited Rendering**
   - Only render last 50 messages
   - Prevent unnecessary re-renders with proper deps

3. **Efficient State Updates**
   - Reducer pattern batches updates
   - No cascading useEffect chains

4. **Smart Scrolling**
   - Virtual scrolling in selectors
   - Only render visible items

## Testing Strategy

### Unit Tests
- **Reducer**: Test all actions and state transitions
- **Services**: Test business logic in isolation
- **Utilities**: Test helper functions

### Integration Tests
- **Hooks**: Test hooks with mock state and agent
- **Containers**: Test smart containers with mock services

### Component Tests
- **Presentational**: Snapshot testing
- **Base Components**: Test keyboard nav and scrolling

## Migration Path

The refactored CLI is in `InkCLIRefactored.tsx` and can be tested alongside the original. To switch:

```typescript
// In cli.ts
import { startInkCliRefactored } from './ink-cli/InkCLIRefactored.js';

// Replace startInkCli with startInkCliRefactored
await startInkCliRefactored(agent);
```

## Metrics

### Code Size
- **Before**: 1150 lines (InkCLI.tsx)
- **After**: ~150 lines (InkCLIRefactored.tsx)
- **Reduction**: 87%

### Complexity
- **Before**: 50+ useState, 15+ useEffect
- **After**: 1 useReducer, 5 custom hooks
- **Reduction**: 90%

### Duplication
- **Before**: ~500 lines duplicated
- **After**: 0 lines (base components)
- **Elimination**: 100%

### Maintainability
- **Before**: Hard to understand, test, modify
- **After**: Clear boundaries, testable, extensible
- **Improvement**: High

## Future Enhancements

1. **Testing**
   - Add comprehensive test suite
   - Integration tests for containers
   - E2E tests for full flows

2. **Performance**
   - Add virtualization for very long message lists
   - Lazy load overlay components

3. **Features**
   - Multi-line input support
   - Message editing
   - Message search
   - Command history search

4. **Architecture**
   - Extract more utilities
   - Add middleware for action logging
   - Create dev tools for debugging

## Conclusion

The refactored architecture provides:
- **Maintainability**: Clear structure and separation of concerns
- **Testability**: Isolated units that can be tested independently
- **Performance**: Optimized rendering and state updates
- **Extensibility**: Easy to add new features
- **Type Safety**: Full TypeScript coverage
- **Developer Experience**: Clear patterns and conventions

This architecture scales well and provides a solid foundation for future development.
