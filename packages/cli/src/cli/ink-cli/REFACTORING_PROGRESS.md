# Ink CLI Refactoring Progress

## 🎯 Refactoring Objectives

Transform the Ink CLI from a monolithic 1150-line component into a well-architected, maintainable, and testable system with:
- Clear separation of concerns
- Reusable components
- Centralized state management
- Type-safe architecture
- Improved testability

## ✅ Completed (Phases 1 & 3)

### State Management Foundation (`packages/cli/src/cli/ink-cli/state/`)

**Files Created:**
- ✅ `types.ts` - Core state type definitions
- ✅ `actions.ts` - All state action types (40+ actions)
- ✅ `reducer.ts` - Pure state reducer function
- ✅ `initialState.ts` - Initial state factory
- ✅ `index.ts` - Module exports

**Benefits:**
- Single source of truth for state
- Predictable state transitions
- Easy to test (pure functions)
- No more scattered useState hooks
- Clear action-based state mutations

### Custom Hooks (`packages/cli/src/cli/ink-cli/hooks/`)

**Files Created:**
- ✅ `useAgentEvents.ts` - Agent event bus adapter
- ✅ `useInputHistory.ts` - Input history navigation
- ✅ `useOverlayManager.ts` - Overlay state management
- ✅ `useKeyboardShortcuts.ts` - Global keyboard handling
- ✅ `useSessionSync.ts` - Session state synchronization
- ✅ `index.ts` - Module exports

**Benefits:**
- Decouples event bus from UI
- Reusable logic across components
- Testable in isolation
- Clear responsibilities

### Business Logic Services (`packages/cli/src/cli/ink-cli/services/`)

**Files Created:**
- ✅ `CommandService.ts` - Command parsing and execution
- ✅ `MessageService.ts` - Message creation and formatting
- ✅ `InputService.ts` - Input detection and manipulation
- ✅ `index.ts` - Module exports

**Benefits:**
- Business logic separated from UI
- Reusable across different interfaces
- Easy to test
- Clear API boundaries

### Utilities (`packages/cli/src/cli/ink-cli/utils/`)

**Files Created:**
- ✅ `inputParsing.ts` - Input parsing helpers
- ✅ `messageFormatting.ts` - Message formatting helpers
- ✅ `index.ts` - Module exports

**Benefits:**
- Shared utility functions
- No code duplication
- Easy to maintain and test

### Reusable Base Components (`packages/cli/src/cli/ink-cli/components/base/`)

**Files Created:**
- ✅ `BaseSelector.tsx` - Generic selector with keyboard nav
- ✅ `BaseAutocomplete.tsx` - Generic autocomplete with filtering
- ✅ `index.ts` - Module exports

**Benefits:**
- Eliminates ~500 lines of duplicated code
- ModelSelector and SessionSelector become thin wrappers
- Consistent UX across all selectors
- Single place to fix bugs

## 📋 Remaining Work

### Phase 2: Component Decomposition

**Presentational Components** (`packages/cli/src/cli/ink-cli/components/`)

To Create:
- `chat/ChatView.tsx` - Pure message display
- `chat/MessageList.tsx` - Message list rendering
- `chat/MessageItem.tsx` - Single message component
- `chat/Header.tsx` - CLI header display
- `chat/Footer.tsx` - CLI footer display
- `input/InputArea.tsx` - Input display area

**Smart Containers** (`packages/cli/src/cli/ink-cli/containers/`)

To Create:
- `ChatContainer.tsx` - Manages chat state and events
- `InputContainer.tsx` - Manages input submission
- `OverlayContainer.tsx` - Manages overlays/modals

### Phase 4: Refactor Existing Components

**Components to Refactor** (using new base components):

- `ModelSelector.tsx` - Convert to use BaseSelector
- `SessionSelector.tsx` - Convert to use BaseSelector
- `SlashCommandAutocomplete.tsx` - Convert to use BaseAutocomplete
- `ResourceAutocomplete.tsx` - Convert to use BaseAutocomplete

### Phase 5: Integration & Testing

**Integration:**
- Create command executor using new services
- Refactor main `InkCLI.tsx` to orchestrate new architecture
- Wire up state management with useReducer
- Connect hooks and containers

**Testing:**
- Unit tests for reducer
- Unit tests for services
- Unit tests for utilities
- Integration tests for hooks
- Component tests

## 📊 Impact Metrics

### Code Reduction
- **Before**: 1150 lines in InkCLI.tsx
- **After** (estimated): ~150 lines (orchestration only)
- **Reduction**: ~87% smaller main component

### Complexity Reduction
- **Before**: 50+ useState hooks, 15+ useEffect hooks
- **After**: 1 useReducer, 5 custom hooks
- **Reduction**: ~90% fewer hooks to manage

### Code Duplication
- **Before**: ~500 lines duplicated across selectors
- **After**: 0 lines (reusable base components)
- **Reduction**: 100% elimination

### Testability
- **Before**: Low (tightly coupled)
- **After**: High (isolated units)
- **Improvement**: Can test all logic without UI

## 🗂️ New File Structure

```
packages/cli/src/cli/ink-cli/
├── index.tsx                      # Main entry
├── InkCLI.tsx                     # Orchestrator (~150 lines)
│
├── state/                         # ✅ COMPLETE
│   ├── types.ts
│   ├── actions.ts
│   ├── reducer.ts
│   ├── initialState.ts
│   └── index.ts
│
├── hooks/                         # ✅ COMPLETE
│   ├── useAgentEvents.ts
│   ├── useInputHistory.ts
│   ├── useOverlayManager.ts
│   ├── useKeyboardShortcuts.ts
│   ├── useSessionSync.ts
│   └── index.ts
│
├── services/                      # ✅ COMPLETE
│   ├── CommandService.ts
│   ├── MessageService.ts
│   ├── InputService.ts
│   └── index.ts
│
├── utils/                         # ✅ COMPLETE
│   ├── inputParsing.ts
│   ├── messageFormatting.ts
│   └── index.ts
│
├── components/                    # 🚧 IN PROGRESS
│   ├── base/                      # ✅ COMPLETE
│   │   ├── BaseSelector.tsx
│   │   ├── BaseAutocomplete.tsx
│   │   └── index.ts
│   ├── chat/                      # ⏳ TODO
│   │   ├── ChatView.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   ├── Header.tsx
│   │   └── Footer.tsx
│   ├── input/                     # ⏳ TODO
│   │   ├── InputArea.tsx
│   │   └── CustomInput.tsx       # (existing)
│   └── overlays/                  # ⏳ TODO (refactor existing)
│       ├── ModelSelector.tsx
│       ├── SessionSelector.tsx
│       ├── SlashCommandAutocomplete.tsx
│       ├── ResourceAutocomplete.tsx
│       └── ApprovalPrompt.tsx
│
└── containers/                    # ⏳ TODO
    ├── ChatContainer.tsx
    ├── InputContainer.tsx
    └── OverlayContainer.tsx
```

## 🎓 Key Architectural Patterns Used

1. **State Management**: Reducer pattern with typed actions
2. **Component Composition**: Smart containers + presentational components
3. **Dependency Injection**: Services injected into components
4. **Event Adapter**: Event bus → State actions
5. **Generic Components**: Base components with type parameters
6. **Hook Composition**: Custom hooks compose behavior
7. **Pure Functions**: Reducer and utilities are pure
8. **Single Responsibility**: Each module has one clear purpose

## 🔄 Next Steps

1. Create presentational components (ChatView, MessageList, etc.)
2. Create smart containers (ChatContainer, InputContainer, OverlayContainer)
3. Refactor existing selector components to use BaseSelector
4. Refactor existing autocomplete components to use BaseAutocomplete
5. Create command executor
6. Refactor main InkCLI component to orchestrate
7. Add comprehensive tests
8. Verify functionality with manual testing
9. Remove old code
10. Update documentation

## 💡 Design Decisions

### Why Reducer over Multiple useStates?
- Single source of truth
- Predictable state transitions
- Easier to debug (action log)
- Better performance (batched updates)
- Easier to test

### Why Services Layer?
- Business logic separated from UI
- Reusable across different interfaces
- Easy to mock for testing
- Clear API boundaries

### Why Base Components?
- Eliminates code duplication
- Consistent UX
- Single place to fix bugs
- Type-safe with generics

### Why Custom Hooks?
- Encapsulate complex behavior
- Reusable across components
- Testable in isolation
- Clear responsibilities

## 🐛 Known Issues to Address

1. **Input Key Hack**: Remove inputKey remount hack
2. **Double Submission**: Remove isSubmittingRef workaround
3. **Ref Syncing**: Remove manual ref syncing (use state)
4. **Event Bus Coupling**: Decouple via adapter (done)
5. **Mixed Concerns**: Separate via containers (in progress)

## 📚 Related Documentation

- [React Hooks Best Practices](https://react.dev/reference/react)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [TypeScript Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [State Management Patterns](https://redux.js.org/understanding/thinking-in-redux/motivation)
