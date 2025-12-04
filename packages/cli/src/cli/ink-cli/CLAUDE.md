# Ink-CLI Architecture Guide

This document provides architectural context for the ink-cli terminal UI implementation.

## Overview

The ink-cli is a React-based terminal UI built with [Ink](https://github.com/vadimdemedes/ink). It provides an interactive chat interface for the Dexto agent.

## Architecture Principles

### 1. Centralized State Management

All state is managed through a **single `useReducer`** in `InkCLIRefactored.tsx`. This replaces the previous 50+ `useState` hooks and provides:

- Predictable state transitions via typed actions
- Single source of truth
- Easy debugging and testing

**State Structure** (`state/types.ts`):
```typescript
interface CLIState {
    messages: Message[];           // Chat history
    streamingMessage: StreamingMessage | null;  // Current LLM response
    input: InputState;             // User input + history
    ui: UIState;                   // Processing, overlays, exit warning
    session: SessionState;         // Session ID + model name
    approval: ApprovalRequest | null;  // Current approval
    approvalQueue: ApprovalRequest[];  // Pending approvals
}
```

### 2. Unified Input Handling

**CRITICAL**: All keyboard input is handled through a **single orchestrator** (`useInputOrchestrator.ts`) that routes events based on focus state. Components expose handlers via refs.

**Architecture:**
```
useInputOrchestrator (single useInput hook)
    │
    ├─→ Approval handler (if approval visible)
    │       └─→ ApprovalPrompt.handleInput (via ref)
    │
    ├─→ Overlay handler (if overlay visible)
    │       └─→ OverlayContainer.handleInput (via ref)
    │               ├─→ SlashCommandAutocomplete.handleInput
    │               ├─→ ResourceAutocomplete.handleInput
    │               ├─→ ModelSelectorRefactored.handleInput → BaseSelector.handleInput
    │               └─→ SessionSelectorRefactored.handleInput → BaseSelector.handleInput
    │
    └─→ Input handler (default, or fallthrough if overlay didn't consume)
            └─→ InputContainer.handleInput (via ref)
                    └─→ MultiLineTextInput.handleInput
```

**Important**: When an overlay handler returns `false` (didn't consume the input), the orchestrator falls through to the main input handler. This allows typing and backspace to work while overlays are visible.

**Focus Priority (highest to lowest):**
1. Approval prompt (when visible)
2. Active overlay (selector/autocomplete)
3. Global shortcuts (Ctrl+C, Escape)
4. Main text input

**Key Components:**
- `useInputOrchestrator.ts` - Single `useInput` hook, routes to handlers
- Components use `forwardRef` + `useImperativeHandle` to expose `handleInput` methods
- Parent collects handlers via refs and passes to orchestrator

### 3. Component Hierarchy

```
InkCLIRefactored (Root Orchestrator)
├── State: useReducer(cliReducer)
├── Input: useInputOrchestrator (single keyboard handler)
├── Events: useAgentEvents (event bus subscription)
│
├── ChatView (presentational)
│   ├── Header
│   └── MessageList → MessageItem
│
├── StatusBar (processing indicator)
│
├── OverlayContainer (smart container)
│   ├── ApprovalPrompt
│   ├── SlashCommandAutocomplete
│   ├── ResourceAutocomplete
│   ├── ModelSelectorRefactored
│   └── SessionSelectorRefactored
│
├── InputContainer (smart container)
│   └── InputArea → MultiLineTextInput
│
└── Footer
```

### 4. Container vs Presentational Pattern

- **Smart Containers** (`containers/`): Handle business logic, dispatch actions
- **Presentational Components** (`components/`): Pure rendering, receive props

## Key Files

| File | Purpose |
|------|---------|
| `InkCLIRefactored.tsx` | Main orchestrator, state initialization |
| `state/reducer.ts` | State reducer with all action handlers |
| `state/types.ts` | Type definitions for state |
| `state/actions.ts` | Action type definitions |
| `hooks/useInputOrchestrator.ts` | Unified keyboard input handler |
| `hooks/useAgentEvents.ts` | Event bus subscriptions |
| `containers/InputContainer.tsx` | Input submission logic |
| `containers/OverlayContainer.tsx` | Overlay interactions |
| `components/MultiLineTextInput.tsx` | Text input rendering + cursor |
| `services/InputService.ts` | Input parsing utilities |
| `services/CommandService.ts` | Slash command execution |

## Input Handling Architecture

### The Input Orchestrator

The `useInputOrchestrator` hook is the **single point of keyboard input**. Components do NOT register their own `useInput` hooks.

```typescript
// In InkCLIRefactored.tsx
useInputOrchestrator({
    state,
    handlers: {
        approval: approvalInputHandler,
        overlay: overlayInputHandler,
        global: globalInputHandler,
        input: mainInputHandler,
    },
});
```

### Handler Pattern

Each component exports a handler factory instead of using `useInput` internally:

```typescript
// Component exports handler factory
export function createApprovalInputHandler(props: ApprovalHandlerProps) {
    return (input: string, key: Key) => {
        // Handle input for this component
    };
}

// NOT this (causes conflicts):
useInput((input, key) => { ... }, { isActive: isVisible });
```

### Focus State

Focus is determined by `CLIState`:
- `state.approval !== null` → Approval has focus
- `state.ui.activeOverlay !== 'none'` → Overlay has focus
- Otherwise → Main input has focus

## Overlay System

### Overlay Types

```typescript
type OverlayType =
    | 'none'
    | 'slash-autocomplete'    // /commands
    | 'resource-autocomplete' // @resources
    | 'model-selector'        // /model interactive
    | 'session-selector'      // /session interactive
    | 'approval';             // Tool approval
```

### Overlay Detection

Overlays are detected via debounced input analysis in `InkCLIRefactored.tsx`:

- Input starts with `/` → `slash-autocomplete`
- Input contains `@` → `resource-autocomplete`
- Input is `/model` → `model-selector`
- Input is `/session` or `/resume` → `session-selector`

Detection is debounced (50ms) to prevent excessive re-renders.

## Event Bus Integration

The CLI subscribes to agent events via `useAgentEvents`:

| Event | Action |
|-------|--------|
| `llm:thinking` | `THINKING_START` |
| `llm:chunk` | `STREAMING_CHUNK` |
| `llm:response` | `STREAMING_END`, `PROCESSING_END` |
| `llm:error` | `ERROR` |
| `llm:tool-call` | Add tool message |
| `llm:tool-result` | Update tool message |
| `approval:request` | `APPROVAL_REQUEST` |

## Session Management

Sessions are managed explicitly via state (not via `agent.getCurrentSessionId()`):

1. Initial session ID passed to component
2. New sessions created on first message (deferred creation)
3. Session switching updates `state.session.id`
4. All agent calls receive explicit `sessionId` parameter

**Race Condition Prevention:**
- Session creation uses a state machine pattern
- Multiple rapid messages wait for the same session creation

## Common Patterns

### Adding a New Overlay

1. Add to `OverlayType` in `state/types.ts`
2. Add detection logic in `InkCLIRefactored.tsx`
3. Create component in `components/`
4. Add handler factory for keyboard input
5. Register in `OverlayContainer.tsx`
6. Add handler to orchestrator config

### Adding a New Slash Command

1. Add to `commands/interactive-commands/commands.ts`
2. Add handler in `CommandService.ts` if needed
3. Command appears automatically in autocomplete

### Adding a New Keyboard Shortcut

1. Add to `globalInputHandler` in the orchestrator
2. Never add a new `useInput` hook directly

## Testing

- Unit tests: `*.test.ts` - Test reducers, services, utilities
- Integration tests: `*.integration.test.ts` - Test full interactions

## Debugging

### Input Issues

1. Check focus state in `useInputOrchestrator`
2. Verify handler is being called (add console.log)
3. Check `state.ui.activeOverlay` value
4. Verify `isDisabled` props are correct

### State Issues

1. Log actions being dispatched
2. Check reducer case for the action type
3. Verify state shape after action

### Rendering Issues

1. Check terminal width detection
2. Verify message limit (default 30)
3. Check for console.log/error calls interfering with Ink

## Anti-Patterns to Avoid

### ❌ Adding useInput to Components

```typescript
// BAD - components should NOT use useInput directly
useInput((input, key) => { ... }, { isActive: condition });
```

Instead, expose handler via ref:
```typescript
// GOOD - component exposes handler via ref
export const MyComponent = forwardRef<MyHandle, Props>((props, ref) => {
    useImperativeHandle(ref, () => ({
        handleInput: (input: string, key: Key) => {
            // Handle input
            return true; // consumed
        }
    }));
    // Render...
});
```

### ❌ Blocking Escape Check with Item Count

```typescript
// BAD - escape won't work when items.length === 0
if (itemsLength === 0) return false;
if (key.escape) { onClose(); return true; }  // Never reached!
```

Instead:
```typescript
// GOOD - escape check before item count
if (key.escape) { onClose(); return true; }  // Always works
if (itemsLength === 0) return false;  // Then check items
```

### ❌ Not Falling Through When Overlay Doesn't Consume

```typescript
// BAD - overlay blocks all input even if it doesn't handle it
case 'overlay':
    handlers.overlay(input, key);  // Ignores return value
    break;
```

Instead:
```typescript
// GOOD - fall through to input handler if not consumed
case 'overlay':
    const consumed = handlers.overlay(input, key);
    if (!consumed && handlers.input) {
        handlers.input(input, key);  // Allow typing/backspace
    }
    break;
```

### ❌ Disabling Input When Overlay Is Active

```typescript
// BAD - prevents fall-through from working
const isInputDisabled =
    ui.isProcessing || !!approval || (ui.activeOverlay !== 'none');
// When overlay returns false and falls through, input handler
// immediately returns false because isDisabled is true!
```

Instead:
```typescript
// GOOD - only disable for actual blocking states
const isInputDisabled = ui.isProcessing || !!approval;
// Orchestrator handles routing - no need to disable for overlays
```

### ❌ Bypassing the Orchestrator

```typescript
// BAD - adding handler directly in InkCLIRefactored
useInput((input, key) => { ... });
```

Instead, add to the orchestrator's handlers:
```typescript
// GOOD - add handler to orchestrator config
useInputOrchestrator({
    state, dispatch, agent,
    handlers: {
        approval: approvalHandler,
        overlay: overlayHandler,
        input: inputHandler,
        // Add new handlers here
    }
});
```

### ❌ Using agent.getCurrentSessionId()

```typescript
// BAD - state might be stale
const sessionId = agent.getCurrentSessionId();
```

### ✅ Correct Patterns

```typescript
// GOOD - explicit session from state
const sessionId = state.session.id;
await agent.run(message, undefined, undefined, sessionId);

// GOOD - component with ref-based handler
export interface MyComponentHandle {
    handleInput: (input: string, key: Key) => boolean;
}

export const MyComponent = forwardRef<MyComponentHandle, Props>((props, ref) => {
    useImperativeHandle(ref, () => ({
        handleInput: (input, key) => {
            if (key.escape) {
                props.onClose();
                return true;
            }
            return false;
        }
    }));
    return <Box>...</Box>;
});
```

## Performance Considerations

- Messages limited to last 30 (configurable)
- Input detection debounced at 50ms
- Components use `useMemo` and `useCallback`
- `MessageItem` uses `memo()` for efficient re-renders
