# Ink-CLI Architecture

React-based terminal UI built with [Ink](https://github.com/vadimdemedes/ink).

## Entry Point

`InkCLIRefactored.tsx` → `startInkCliRefactored()`

Two rendering modes (controlled by `USE_ALTERNATE_BUFFER` constant):
- **StaticCLI** (default): Uses Ink's `<Static>` for copy-friendly terminal scrollback
- **AlternateBufferCLI**: Fullscreen with VirtualizedList and mouse support

## State Management

State is managed via **multiple useState hooks** in `useCLIState.ts`.

### Message State (separate arrays for render ordering)

```typescript
messages: Message[]           // Finalized → rendered in <Static>
pendingMessages: Message[]    // Streaming → rendered dynamically
dequeuedBuffer: Message[]     // User messages after pending (ordering fix)
queuedMessages: QueuedMessage[] // Waiting to be processed
```

### CLIState

```typescript
interface CLIState {
  input: InputState           // value, history, images, pastedBlocks
  ui: UIState                 // isProcessing, activeOverlay, exitWarning
  session: SessionState       // id, modelName
  approval: ApprovalRequest | null
  approvalQueue: ApprovalRequest[]
}
```

### Message Interface

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: Date
  isStreaming?: boolean
  toolResult?: string
  toolStatus?: 'running' | 'finished'
  isError?: boolean              // Tool execution failed
  styledType?: StyledMessageType // config, stats, help, session-list, etc.
  styledData?: StyledData
  isContinuation?: boolean       // Split message continuation
}
```

## Component Hierarchy

```text
InkCLIRefactored
├── KeypressProvider
├── MouseProvider (alternate buffer only)
├── ScrollProvider (alternate buffer only)
└── StaticCLI / AlternateBufferCLI
    ├── Header
    ├── Messages (Static or VirtualizedList)
    ├── PendingMessages (dynamic, outside Static)
    ├── StatusBar
    ├── OverlayContainer
    ├── InputContainer → TextBufferInput
    └── Footer
```

## Input Architecture

### Keyboard Flow

1. `KeypressContext` captures raw stdin
2. `useInputOrchestrator` routes to handlers based on focus
3. Main text input uses its own `useKeypress()` in `TextBufferInput`

### Focus Priority

1. **Approval prompt** (if visible)
2. **Overlay** (if active)
3. **Global shortcuts** (Ctrl+C, Escape)
4. **Main input** (TextBufferInput)

### Global Shortcuts

- **Ctrl+C**: Cancel processing → clear input → exit warning → exit
- **Escape**: Clear exit warning → cancel processing → close overlay
- **Ctrl+S**: Toggle copy mode (alternate buffer only)

## Overlay System

### All Overlay Types

```typescript
type OverlayType =
  | 'none'
  | 'slash-autocomplete'         // /command
  | 'resource-autocomplete'      // @resource
  | 'model-selector'             // /model
  | 'session-selector'           // /session, /resume
  | 'session-subcommand-selector'
  | 'mcp-selector'
  | 'mcp-add-selector'
  | 'mcp-remove-selector'
  | 'mcp-custom-type-selector'
  | 'mcp-custom-wizard'
  | 'log-level-selector'
  | 'approval'
```

### Detection

Overlays detected by input content (debounced 50ms):
- `/` prefix → slash-autocomplete (or specific selector)
- `@` anywhere → resource-autocomplete

## Key Files

| File | Purpose |
|------|---------|
| `InkCLIRefactored.tsx` | Entry point, provider setup |
| `hooks/useCLIState.ts` | All state management |
| `hooks/useInputOrchestrator.ts` | Keyboard routing |
| `hooks/useAgentEvents.ts` | Event subscriptions |
| `services/processStream.ts` | Streaming handler |
| `services/CommandService.ts` | Command execution |
| `containers/OverlayContainer.tsx` | Overlay management |
| `components/shared/text-buffer.ts` | Input text buffer |

## Critical Rules

### Do

- Use `TextBuffer` as source of truth for input
- Pass explicit `sessionId` to all agent calls
- Check `key.escape` BEFORE checking item count in selectors
- Return `boolean` from handlers (`true` = consumed)
- Use refs + `useImperativeHandle` for component coordination

### Don't

```typescript
// Adding useInput directly to components
useInput((input, key) => { ... });  // Don't do this

// Checking item count before escape
if (items.length === 0) return false;
if (key.escape) { onClose(); return true; }  // Never reached!

// Using agent.getCurrentSessionId()
const sessionId = agent.getCurrentSessionId();  // Stale!
// Use state.session.id instead
```

## Common Tasks

### Add New Overlay

1. Add to `OverlayType` in `state/types.ts`
2. Add detection in `useCLIState.ts`
3. Create component in `components/overlays/`
4. Register in `OverlayContainer.tsx`
5. **If overlay has its own text input** (wizard, search, etc.): Add to `overlaysWithOwnInput` array in `InputContainer.tsx` (~line 659) to disable main input while overlay is active

### Add New Slash Command

1. Add to `commands/interactive-commands/commands.ts`
2. Add handler in `CommandService.ts` if needed
3. Appears in autocomplete automatically

## Streaming Architecture

`processStream.ts` handles the async iterator from `agent.stream()`:

- Streaming content → `pendingMessages` (redrawn each frame)
- Finalized content → `messages` (in `<Static>`, rendered once)
- Large content split at markdown boundaries to reduce flickering
- Uses `localPending` mirror to avoid React batching race conditions
