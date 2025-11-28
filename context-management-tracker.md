# Context Management Refactor - Progress Tracker

> **Based on**: `complete-context-management-plan.md`
> **Last Updated**: 2025-11-28

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Type Cleanup | ✅ Complete | Foundation types in place |
| Phase 1: Tool Output Truncation | ✅ Complete | `truncateToolResult()` implemented |
| Phase 2: StreamProcessor | ✅ Complete | Handles persistence via stream events |
| Phase 3: TurnExecutor Shell | ✅ Complete | Main loop, toModelOutput, abort handling |
| Phase 4: Reactive Compression | ✅ Complete | `ReactiveOverflowStrategy`, `filterCompacted()` |
| Phase 5: Pruning | ✅ Complete | `pruneOldToolOutputs()`, `markMessagesAsCompacted()` |
| Phase 6: MessageQueue | ✅ Complete | `MessageQueueService`, multimodal coalescing |
| Phase 6.5: Unit Tests | ✅ Complete | MessageQueueService + filterCompacted tests |
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

### Phase 3: TurnExecutor Shell ✅

- [x] Create `TurnExecutor` class in `llm/executor/turn-executor.ts`
- [x] Implement main loop with `stopWhen: stepCountIs(1)`
- [x] Add `toModelOutput` to tool definitions (for multimodal)
- [x] Integrate StreamProcessor
- [x] Add abort signal handling
- [x] Defensive `extractImageData`/`extractFileData` for raw results
- [ ] Test tool execution still works (deferred to Phase 8 integration)

### Phase 4: Reactive Compression ✅

- [x] Implement `ReactiveOverflowStrategy` in `context/compression/reactive-overflow.ts`
- [x] Add `isOverflow()` in `context/compression/overflow.ts` using actual tokens
- [x] Implement LLM-based summarization using `generateText`
- [x] Add `validate()` method for compression result validation
- [x] Add `filterCompacted()` in `context/utils.ts` for read-time filtering
- [x] Wire `filterCompacted()` into `ContextManager.getFormattedMessagesWithCompression()`
- [x] Add TODO comments for Phase 8 cleanup
- [ ] Wire overflow check and compression into TurnExecutor (deferred - needs TurnExecutor integration)

### Phase 5: Pruning (compactedAt) ✅

- [x] Add `markMessagesAsCompacted()` method to ContextManager
- [x] Add compacted tool message transformation in `getFormattedMessagesWithCompression()`
- [x] Implement `pruneOldToolOutputs()` in TurnExecutor (uses message IDs, proper typing)
- [x] Wire `pruneOldToolOutputs()` into TurnExecutor main loop
- [x] Add `context:pruned` event to `SessionEventMap`, `AgentEventMap`, and `STREAMING_EVENTS`
- [x] Delete dead code: `updateConfig()`, `setSystemPrompt()`

### Phase 6: MessageQueue with Multimodal ✅

- [x] Create `MessageQueueService` in `session/message-queue.ts`
- [x] Implement multimodal coalescing (text + images + files)
- [x] Handle edge cases (empty messages, single message optimization)
- [x] Add `message:queued` and `message:dequeued` events to `events/index.ts`
- [x] Add queue check in TurnExecutor main loop
- [x] Make `MessageQueueService` a mandatory parameter for TurnExecutor
- [ ] Modify `/api/message` to queue when busy (deferred - needs API layer integration)
- [ ] Test user guidance during task execution (deferred - needs integration testing)

### Phase 6.5: Unit Tests for Context Management ✅

Unit tests for new modules created in Phases 1-6.

#### MessageQueueService Tests (`session/message-queue.test.ts`) ✅
- [x] `enqueue()` - adds message, returns position/id, emits event, handles metadata
- [x] `dequeueAll()` - returns null when empty, returns CoalescedMessage, clears queue, emits event
- [x] Coalescing - single message as-is, two messages "First/Also", 3+ numbered, multimodal preserved
- [x] `hasPending()` / `pendingCount()` - return correct values
- [x] `clear()` - empties queue

#### filterCompacted Tests (add to `context/utils.test.ts`) ✅
- [x] Returns all messages if no summary
- [x] Returns summary + messages after it
- [x] Handles multiple summaries (most recent wins)
- [x] Handles empty history

#### Deferred to Phase 8 (Integration Tests)
The following require extensive mocking and are better tested during integration:
- StreamProcessor tests (stream events, ContextManager, ResourceManager mocking)
- TurnExecutor tests (Vercel AI SDK, full loop mocking)
- ReactiveOverflowStrategy tests (LLM mocking)
- Overflow detection tests (not yet wired into TurnExecutor)

### Phase 7: defer() Cleanup 🔲

- [ ] Implement `defer()` utility in `util/defer.ts`
- [ ] Add to TurnExecutor for automatic cleanup
- [ ] Test cleanup on normal exit, throw, and abort
- [ ] Verify no resource leaks

### Phase 8: Integration + Migration 🔲

- [ ] Update `vercel.ts` to use TurnExecutor
- [ ] Delete stubbed compression methods from ContextManager
- [ ] Simplify ContextManager - review what can be deleted once TurnExecutor is integrated
- [ ] Update event emissions
- [ ] Wire overflow detection (`isOverflow`) into TurnExecutor
- [ ] Wire ReactiveOverflowStrategy into TurnExecutor
- [ ] Full integration testing (StreamProcessor, TurnExecutor, compression)
- [ ] Consider multimodal compression improvements (currently text-only summaries)

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

### 6. addToolResult Refactored (Phase 3)
**Decision**: `ContextManager.addToolResult` now only persists - caller sanitizes first.

**Old signature**: `addToolResult(callId, name, rawResult, options) → SanitizedToolResult`
**New signature**: `addToolResult(callId, name, sanitizedResult) → void`

**Rationale**: Single responsibility - ContextManager just stores, sanitization happens at call site.

**Temp fix applied to**: `vercel.ts`, `anthropic.ts`, `openai.ts` (will be removed in Phase 8 when TurnExecutor replaces them).

### 7. toModelOutput Handles Raw Results
**Issue**: `toModelOutput` receives RAW tool results (before sanitization), so can't use typed helpers like `getImageData`.

**Resolution**: Created defensive extraction methods in TurnExecutor:
- `extractImageData()` - checks both `image` and `data` fields
- `extractFileData()` - handles various buffer types

### 8. Compression Persistence Model (Phase 4)
**Issue**: Initial approach was to replace history with compressed version, requiring a new `replaceHistory()` method on `IConversationHistoryProvider`.

**Resolution**: Adopt OpenCode-style additive approach instead:
- **Add summary message** with `metadata.isSummary: true` (use existing `addMessage()`)
- **Filter at read-time** via `filterCompacted()` in `getFormattedMessages()`
- **No history replacement** - original messages preserved in storage
- **Mark old tool outputs** with `compactedAt` timestamp (Phase 5: Pruning)

**Benefits**:
- No interface changes needed
- Non-destructive (full audit trail preserved)
- Recovery possible if needed
- Consistent with battle-tested OpenCode approach

**Key insight from OpenCode analysis**: They use `filterCompacted()` to logically truncate history at read-time, stopping at the most recent summary message. This means LLM never sees pre-compression history, but it remains in storage.

### 9. MessageQueueService is Mandatory (Phase 6)
**Issue**: Should `MessageQueueService` be optional or required in TurnExecutor?

**Decision**: Made it **mandatory** parameter.

**Rationale**:
- TurnExecutor is the new architecture (Phase 8 will fully integrate it)
- `MessageQueueService` is stateless and cheap - just holds an empty array if unused
- Core feature of the "controlled loop" design philosophy
- Cleaner code without null checks

**Usage**: Callers must provide a `MessageQueueService` instance. If queuing isn't needed, the queue simply remains empty.

---

## Files Changed (Phase 0-6.5)

### New Files
- `packages/core/src/llm/executor/stream-processor.ts` (Phase 2)
- `packages/core/src/llm/executor/tool-output-truncator.ts` (Phase 1)
- `packages/core/src/llm/executor/tool-output-truncator.test.ts` (Phase 1)
- `packages/core/src/llm/executor/types.ts` (Phase 2)
- `packages/core/src/llm/executor/turn-executor.ts` (Phase 3)
- `packages/core/src/context/compression/overflow.ts` (Phase 4)
- `packages/core/src/context/compression/reactive-overflow.ts` (Phase 4)
- `packages/core/src/session/types.ts`
- `packages/core/src/session/message-queue.ts` (Phase 6)
- `packages/core/src/session/message-queue.test.ts` (Phase 6.5)

### Modified Files
- `packages/core/src/agent/schemas.ts` - Added `tools` field
- `packages/core/src/context/compression/types.ts` - New `ICompressionStrategy` interface
- `packages/core/src/context/manager.ts` - Added `filterCompacted()` to history retrieval, `markMessagesAsCompacted()`, compacted transformation, TODO comments for Phase 8, removed dead code (`updateConfig`, `setSystemPrompt`)
- `packages/core/src/context/types.ts` - Added `compactedAt`, `metadata`
- `packages/core/src/context/utils.ts` - Added `filterCompacted()`, `formatToolOutputForDisplay()`
- `packages/core/src/context/utils.test.ts` - Added `filterCompacted` tests (Phase 6.5)
- `packages/core/src/events/index.ts` - Added `context:pruned`, `message:queued`, `message:dequeued` events to `SessionEventMap`, `AgentEventMap`, `STREAMING_EVENTS`
- `packages/core/src/session/index.ts` - Export `MessageQueueService`, `UserMessage`, `QueuedMessage`, `CoalescedMessage`, `UserMessageContentPart`
- `packages/core/src/llm/executor/turn-executor.ts` - Added `MessageQueueService` as mandatory parameter, `injectQueuedMessages()` method
- `packages/core/src/llm/types.ts` - Added `TokenUsage`
- `packages/core/src/llm/executor/turn-executor.ts` - Added `pruneOldToolOutputs()`, `estimateToolTokens()`, wired into main loop
- `packages/core/src/llm/services/README.md` - Removed outdated token counting example
- `packages/core/src/logger/v2/types.ts` - Added `EXECUTOR` component
- `packages/core/src/session/history/database.ts` - Added `updateMessage()`
- `packages/core/src/session/history/memory.ts` - Added `updateMessage()`
- `packages/core/src/session/history/types.ts` - Added `updateMessage()` to interface
- `packages/core/src/tools/schemas.ts` - Added `ToolLimitsSchema`, `ToolsConfigSchema`
- `packages/agent-management/src/writer.test.ts` - Updated for new schema

### Deleted Files
- `packages/core/src/context/compression/middle-removal.ts`
- `packages/core/src/context/compression/oldest-removal.ts`

### Dead Code Removed (Phase 4)
- `ContextManager.getTotalTokenCount()` - never used
- `ContextManager.getTokenCount()` - only in README example
- `ContextManager.shouldCompress()` - never used
- `ContextManager.compressHistoryIfNeeded()` - stubbed and no longer called

---

## Next Steps

1. **Phase 7**: defer() cleanup pattern
2. **Phase 8**: Integration - wire TurnExecutor into vercel.ts, wire compression, full integration testing
