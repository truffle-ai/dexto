# Context Management Refactor - Progress Tracker

> **Based on**: `complete-context-management-plan.md`
> **Last Updated**: 2024-11-28

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Type Cleanup | ✅ Complete | Foundation types in place |
| Phase 1: Tool Output Truncation | ✅ Complete | `truncateToolResult()` implemented |
| Phase 2: StreamProcessor | ✅ Complete | Handles persistence via stream events |
| Phase 3: TurnExecutor Shell | 🔲 Not Started | Main loop with `stopWhen: stepCountIs(1)` |
| Phase 4: Reactive Compression | 🔲 Not Started | `ReactiveOverflowStrategy` |
| Phase 5: Pruning | 🔲 Not Started | Mark with `compactedAt` |
| Phase 6: MessageQueue | 🔲 Not Started | Multimodal coalescing |
| Phase 7: defer() Cleanup | 🔲 Not Started | TC39 pattern |
| Phase 8: Integration | 🔲 Not Started | Update `vercel.ts` |

---

## Detailed Task List

### Phase 0: Type Cleanup (Foundation) ✅

- [x] Delete old compression module (`packages/core/src/context/compression/middle-removal.ts`, `oldest-removal.ts`)
- [x] Define new `ICompressionStrategy` interface with `trigger` field
- [x] Add `compactedAt` field to `InternalMessage` type
- [x] Add `metadata` field to `InternalMessage` type
- [x] Add `TokenUsage` interface to `llm/types.ts`

### Phase 1: Tool Output Truncation ✅

- [x] Implement `truncateToolResult()` in `llm/executor/tool-output-truncator.ts`
- [x] Add `ToolLimitsSchema` and `ToolsConfigSchema` to `tools/schemas.ts`
- [x] Add `tools` field to `AgentConfigSchema`
- [x] Write tests for truncation (`tool-output-truncator.test.ts`)

### Phase 2: StreamProcessor WITH Persistence ✅

- [x] Create `StreamProcessor` class in `llm/executor/stream-processor.ts`
- [x] Handle `text-delta` events → `appendAssistantText()`
- [x] Handle `tool-call` events → `addToolCall()`
- [x] Handle `tool-result` events → sanitize, truncate, persist
- [x] Handle `finish` events → capture token usage
- [x] Handle `error` events
- [x] Emit events for UI (`llm:chunk`, `llm:tool-call`, `llm:tool-result`, `llm:response`)
- [x] Add `updateMessage()` to history providers (database, memory)
- [x] Add new ContextManager methods (`appendAssistantText`, `addToolCall`, `updateAssistantMessage`)

### Phase 3: TurnExecutor Shell 🔲

- [ ] Create `TurnExecutor` class in `llm/executor/turn-executor.ts`
- [ ] Implement main loop with `stopWhen: stepCountIs(1)`
- [ ] Add `toModelOutput` to tool definitions (for multimodal)
- [ ] Integrate StreamProcessor
- [ ] Add abort signal handling
- [ ] Test tool execution still works

### Phase 4: Reactive Compression 🔲

- [ ] Implement `ReactiveOverflowStrategy` in `context/compression/reactive-overflow.ts`
- [ ] Add `isOverflow()` check using actual tokens from last step
- [ ] Implement LLM-based summarization
- [ ] Add `validate()` method for compression result validation
- [ ] Test compression triggers at correct time

### Phase 5: Pruning (compactedAt) 🔲

- [ ] Implement `pruneOldToolOutputs()` in TurnExecutor
- [ ] Update `formatToolOutput()` to return placeholder for compacted
- [ ] Test pruning preserves history for debugging

### Phase 6: MessageQueue with Multimodal 🔲

- [ ] Create `MessageQueueService` in `session/message-queue.ts`
- [ ] Implement multimodal coalescing (text + images + files)
- [ ] Handle edge cases (all images, large images as blobs)
- [ ] Add queue check in TurnExecutor main loop
- [ ] Modify `/api/message` to queue when busy
- [ ] Test user guidance during task execution

### Phase 7: defer() Cleanup 🔲

- [ ] Implement `defer()` utility in `util/defer.ts`
- [ ] Add to TurnExecutor for automatic cleanup
- [ ] Test cleanup on normal exit, throw, and abort
- [ ] Verify no resource leaks

### Phase 8: Integration + Migration 🔲

- [ ] Update `vercel.ts` to use TurnExecutor
- [ ] Delete stubbed compression methods from ContextManager
- [ ] Update event emissions
- [ ] Full integration testing

---

## Decisions Made

### 1. Vercel AI SDK Stream Event Property Names
**Issue**: Documentation was outdated; actual types differ.

| Event | Plan Said | Actual |
|-------|-----------|--------|
| `tool-call` | `args` | `input` |
| `tool-result` | `result` | `output` |
| `finish` | `usage` | `totalUsage` |

**Resolution**: Updated `StreamProcessor` to use correct property names.

### 2. Tool Call Structure for `addToolCall()`
**Issue**: Code was adding `name` and `arguments` at top level.

**Resolution**: Tool calls must follow OpenAI format:
```typescript
{
  id: string;
  type: 'function';
  function: { name: string; arguments: string; }
}
```

### 3. TokenUsage Values May Be Undefined
**Issue**: `totalUsage.inputTokens` etc. can be `undefined`.

**Resolution**: Use nullish coalescing: `event.totalUsage.inputTokens ?? 0`

### 4. Compression Strategies Stubbed
**Decision**: Old compression strategies deleted, methods stubbed to return history unchanged.

**Rationale**: Compression will be handled by TurnExecutor via reactive strategies (Phase 4). No point maintaining old sync code.

### 5. Test Schema Updates
**Issue**: `writer.test.ts` used old `tools` schema format.

**Resolution**: Updated test to use new `ToolsConfigSchema` structure:
```typescript
tools: {
  bash: { maxOutputChars: 30000 },
  read: { maxLines: 2000, maxLineLength: 2000 },
}
```

---

## Files Changed (Phase 0-2)

### New Files
- `packages/core/src/llm/executor/stream-processor.ts`
- `packages/core/src/llm/executor/tool-output-truncator.ts`
- `packages/core/src/llm/executor/tool-output-truncator.test.ts`
- `packages/core/src/llm/executor/types.ts`
- `packages/core/src/session/types.ts`

### Modified Files
- `packages/core/src/agent/schemas.ts` - Added `tools` field
- `packages/core/src/context/compression/types.ts` - New `ICompressionStrategy` interface
- `packages/core/src/context/manager.ts` - New methods, stubbed compression
- `packages/core/src/context/types.ts` - Added `compactedAt`, `metadata`
- `packages/core/src/llm/types.ts` - Added `TokenUsage`
- `packages/core/src/logger/v2/types.ts` - Added `EXECUTOR` component
- `packages/core/src/session/history/database.ts` - Added `updateMessage()`
- `packages/core/src/session/history/memory.ts` - Added `updateMessage()`
- `packages/core/src/session/history/types.ts` - Added `updateMessage()` to interface
- `packages/core/src/tools/schemas.ts` - Added `ToolLimitsSchema`, `ToolsConfigSchema`
- `packages/agent-management/src/writer.test.ts` - Updated for new schema

### Deleted Files
- `packages/core/src/context/compression/middle-removal.ts`
- `packages/core/src/context/compression/oldest-removal.ts`

---

## Next Steps

1. **Phase 3**: Implement `TurnExecutor` with `stopWhen: stepCountIs(1)` loop
2. Wire up `StreamProcessor` inside `TurnExecutor`
3. Add `toModelOutput` for multimodal tool results
