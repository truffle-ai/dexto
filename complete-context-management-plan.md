# Complete Context Management Plan

> **Status**: Draft
> **Created**: 2024-11-27
> **Related Issues**: Message cancellation, message queuing, context compression

## Problem Statement

Our current Vercel SDK integration has several issues:

1. **Message Order Bug**: Tool results are added before assistant messages (wrong order)
2. **Cumulative Token Counts**: `totalUsage` is cumulative across steps, causing false compression triggers
3. **Limited Loop Control**: Vercel's internal loop limits our ability to:
   - Properly manage message persistence order
   - Implement mid-stream cancellation with partial state persistence
   - Queue and process user messages during agent execution
   - Apply async compression between steps

## Research Findings

### OpenCode Approach
- **Custom loop**: `loop(sessionID)` function with full control
- **Compression**: LLM summary + prune old tool outputs (keep last 40K tokens)
- **Token counting**: Simple `length/4` estimation
- **Persistence**: Part-based, immediate updates via `Session.updatePart()`
- **Cancellation**: `defer()` cleanup pattern with abort signals

### Gemini-CLI Approach
- **Custom loop**: `executeTurn()` in AgentExecutor class
- **Compression**: LLM summary at 50% threshold, preserve last 30%
- **Token counting**: Heuristic (ASCII ~0.25, non-ASCII ~1.3 tokens/char) + API fallback
- **Persistence**: File-based JSON with queued metadata pattern
- **Tool execution**: Parallel via `Promise.all()`
- **Cancellation**: AbortController with grace period for recovery

### Vercel AI SDK (Current)
- **Internal loop**: `maxSteps` controls iterations, callbacks for hooks
- **Compression**: `prepareStep` (synchronous only)
- **Token counting**: Per-step in `onStepFinish`, cumulative in `totalUsage`
- **Tool execution**: `execute` callback, runs before `onStepFinish`

## Key Insight: `maxSteps: 1`

The Vercel SDK's `execute` function is **optional**. When omitted:
- Tools are returned in `toolCalls` but not executed
- We can execute them manually and construct the next call
- With `maxSteps: 1`, we get a single LLM call without internal looping

This gives us full control while still using Vercel's:
- Provider abstraction
- Streaming infrastructure
- Message formatting
- Error handling

## Proposed Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DEXTO AGENT LOOP (NEW)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      MESSAGE QUEUE SERVICE                           │   │
│  │  - Accepts user messages anytime                                     │   │
│  │  - Returns immediately with "queued" status                          │   │
│  │  - Loop consumes from queue when ready                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        AGENT EXECUTOR                                │   │
│  │                                                                      │   │
│  │  while (!terminated) {                                               │   │
│  │    // 1. CHECK QUEUE - Get next user message if idle                 │   │
│  │    const userMsg = await messageQueue.dequeue();                     │   │
│  │    if (userMsg) await persistMessage(userMsg);                       │   │
│  │                                                                      │   │
│  │    // 2. COMPRESSION CHECK - Before each LLM call                    │   │
│  │    await compressIfNeeded(); // Async, full control                  │   │
│  │                                                                      │   │
│  │    // 3. SINGLE-STEP LLM CALL - No internal tool loop                │   │
│  │    const response = await streamText({                               │   │
│  │      messages: getFormattedMessages(),                               │   │
│  │      tools: toolsWithoutExecute, // We execute manually              │   │
│  │      maxSteps: 1,  // KEY: Single step only                          │   │
│  │    });                                                               │   │
│  │                                                                      │   │
│  │    // 4. PERSIST ASSISTANT MESSAGE (correct order!)                  │   │
│  │    await persistAssistantMessage(response.text, response.toolCalls); │   │
│  │    updateActualTokenCount(response.usage.inputTokens);               │   │
│  │                                                                      │   │
│  │    // 5. CHECK TERMINATION                                           │   │
│  │    if (!response.toolCalls?.length) break; // No tools = done        │   │
│  │    if (this.abortController.signal.aborted) break;                   │   │
│  │    if (stepCount >= maxSteps) break;                                 │   │
│  │                                                                      │   │
│  │    // 6. EXECUTE TOOLS (parallel or sequential)                      │   │
│  │    for (const toolCall of response.toolCalls) {                      │   │
│  │      const result = await executeTool(toolCall);                     │   │
│  │      await persistToolResult(toolCall.id, result); // After asst!    │   │
│  │    }                                                                 │   │
│  │                                                                      │   │
│  │    stepCount++;                                                      │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Message Queue Service

```typescript
class MessageQueueService {
  private queue: QueuedMessage[] = [];

  // Called by API endpoint - returns immediately
  async enqueue(message: UserMessage): Promise<{ queued: true; position: number }> {
    const queuedMsg = { ...message, queuedAt: Date.now() };
    this.queue.push(queuedMsg);
    this.emit('message:queued', queuedMsg);
    return { queued: true, position: this.queue.length };
  }

  // Called by executor when ready for next message
  async dequeue(): Promise<UserMessage | null> {
    return this.queue.shift() ?? null;
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }
}
```

#### 2. Cancellation Handler

```typescript
class CancellationHandler {
  private abortController: AbortController;
  private currentState: 'idle' | 'streaming' | 'executing_tools' = 'idle';
  private partialResponse: PartialResponse | null = null;

  async cancel(): Promise<CancellationResult> {
    this.abortController.abort();

    switch (this.currentState) {
      case 'streaming':
        // Persist partial assistant message
        if (this.partialResponse?.text) {
          await this.persistPartialAssistant(this.partialResponse);
        }
        return { cancelled: true, persisted: 'partial_assistant' };

      case 'executing_tools':
        // Let current tool finish, don't start new ones
        return { cancelled: true, persisted: 'tools_in_progress' };

      case 'idle':
        return { cancelled: true, persisted: null };
    }
  }

  updatePartialResponse(chunk: StreamChunk): void {
    if (!this.partialResponse) {
      this.partialResponse = { text: '', toolCalls: [] };
    }
    if (chunk.type === 'text-delta') {
      this.partialResponse.text += chunk.text;
    }
  }
}
```

#### 3. Compression Service

```typescript
class CompressionService {
  private readonly THRESHOLD = 0.8; // 80% of max
  private readonly PRESERVE_RATIO = 0.3; // Keep last 30%

  async compressIfNeeded(
    history: InternalMessage[],
    tokenizer: ITokenizer,
    maxTokens: number,
    actualTokens?: number
  ): Promise<{ compressed: boolean; newHistory?: InternalMessage[] }> {

    const currentTokens = actualTokens ?? this.estimateTokens(history, tokenizer);

    if (currentTokens < maxTokens * this.THRESHOLD) {
      return { compressed: false };
    }

    // Find safe split point (end of a complete turn)
    const splitPoint = this.findSplitPoint(history, this.PRESERVE_RATIO);

    const toCompress = history.slice(0, splitPoint);
    const toKeep = history.slice(splitPoint);

    // LLM-based summary (like gemini-cli)
    const summary = await this.generateSummary(toCompress);

    const newHistory = [
      { role: 'system', content: `Previous context summary:\n${summary}` },
      ...toKeep
    ];

    return { compressed: true, newHistory };
  }

  private findSplitPoint(history: InternalMessage[], preserveRatio: number): number {
    const targetIndex = Math.floor(history.length * (1 - preserveRatio));

    // Walk backwards to find safe split (not in middle of tool call chain)
    for (let i = targetIndex; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === 'assistant' && !this.hasPendingTools(history, i)) {
        return i + 1;
      }
    }
    return targetIndex;
  }
}
```

### Message Flow Comparison

**Current (Broken):**
```
user → tool:A → tool:B → asst(tool:A,B) → tool:C → asst(tool:C)
       ↑         ↑         ↑
       During execute()   onStepFinish() backfills
```

**Proposed (Correct):**
```
user → asst(tool:A,B) → tool:A → tool:B → asst(tool:C) → tool:C
       ↑                 ↑         ↑
       After LLM call   After tool execution
```

## Migration Path

### Phase 1: Bug Fixes (Current) ✅
- [x] Fix cumulative token count overwrite
- [x] Add assistant messages in onStepFinish
- [x] Skip processLLMResponse when tools were used

### Phase 2: Extract Tool Execution
- [ ] Define tools WITHOUT execute callbacks
- [ ] Move tool execution logic to separate function
- [ ] Test that toolCalls are returned correctly

### Phase 3: Implement Custom Loop
- [ ] Create AgentExecutor class
- [ ] Implement single-step LLM calls with `maxSteps: 1`
- [ ] Handle message persistence in correct order
- [ ] Integrate compression between steps

### Phase 4: Message Queue
- [ ] Create MessageQueueService
- [ ] Add API endpoint for queued messages
- [ ] Integrate queue consumption into executor loop

### Phase 5: Cancellation
- [ ] Create CancellationHandler
- [ ] Track partial response state during streaming
- [ ] Persist partial state on cancellation
- [ ] Add API endpoint for cancellation

## Benefits

| Aspect | Current | Proposed |
|--------|---------|----------|
| Message Order | Wrong (tool before asst) | Correct |
| Compression | Sync only (prepareStep) | Async, between steps |
| Token Counting | Cumulative confusion | Per-step, accurate |
| Cancellation | Signal only | Full state persistence |
| Message Queue | Not supported | First-class support |
| Tool Execution | Callback-based | Full control |
| Testability | Hard (internal loop) | Easy (isolated components) |

## Open Questions

1. **Streaming during custom loop**: Does `maxSteps: 1` still support streaming? (Yes, confirmed)
2. **Tool execution order**: Parallel (like gemini-cli) or sequential? Configurable?
3. **Compression strategy**: LLM summary vs prune tool outputs vs hybrid?
4. **Queue persistence**: Should queued messages survive server restart?

---

## Tool Modifications

### Current Tool Wrapping (vercel.ts lines 121-200)

Currently, tools are wrapped with `execute` callbacks in `vercel.ts`:

```typescript
// Current: Tools have execute callbacks
acc[toolName] = {
    inputSchema: jsonSchema(tool.parameters),
    execute: async (args: unknown, options: { toolCallId: string }) => {
        // This runs INSIDE Vercel's loop, BEFORE onStepFinish
        const result = await this.toolManager.executeTool(toolName, args, sessionId);
        await this.contextManager.addToolResult(callId, toolName, result);
        return expandedResult;
    },
};
```

### Required Changes

#### 1. Remove `execute` from tool definitions

```typescript
// New: Tools WITHOUT execute callbacks
acc[toolName] = {
    inputSchema: jsonSchema(tool.parameters),
    // NO execute - we handle this in our loop
};
```

#### 2. Tools Affected

All tools flow through `ToolManager.executeTool()`, so the change is centralized:

| Tool Source | Location | Change Required |
|-------------|----------|-----------------|
| MCP Tools | `packages/core/src/mcp/manager.ts` | None - just schema |
| Internal Tools | `packages/core/src/tools/internal-tools/` | None - just schema |

**Internal Tools (12 files):**
- `ask-user-tool.ts`
- `bash-exec-tool.ts`
- `bash-output-tool.ts`
- `delegate-to-url-tool.ts`
- `edit-file-tool.ts`
- `glob-files-tool.ts`
- `grep-content-tool.ts`
- `kill-process-tool.ts`
- `read-file-tool.ts`
- `search-history-tool.ts`
- `write-file-tool.ts`

**No changes needed to tool implementations** - only the wrapping in `vercel.ts` changes.

#### 3. New Tool Execution in Executor

```typescript
// In AgentExecutor
async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
        // Emit event before execution
        this.eventBus.emit('llm:tool-call', {
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            arguments: toolCall.input,
        });

        // Execute via ToolManager (handles MCP vs internal routing)
        const rawResult = await this.toolManager.executeTool(
            toolCall.toolName,
            toolCall.input as Record<string, unknown>,
            this.sessionId
        );

        // Sanitize and persist (handles blob storage)
        const sanitized = await this.contextManager.addToolResult(
            toolCall.toolCallId,
            toolCall.toolName,
            rawResult
        );

        // Emit event after execution
        this.eventBus.emit('llm:tool-result', {
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            result: sanitized,
        });

        results.push({
            toolCallId: toolCall.toolCallId,
            result: sanitized,
        });
    }

    return results;
}
```

---

## Blob/Storage/Resources Integration

### Current Flow (Working)

The blob handling flow is already well-architected. Here's how it works:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      RESOURCE/BLOB FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER INPUT (images, files)                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ContextManager.addUserMessage()                                      │   │
│  │   └─ processUserInput() → stores large data as @blob:xyz             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  TOOL RESULTS (images, MCP resources)                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ContextManager.addToolResult()                                       │   │
│  │   └─ sanitizeToolResult() (context/utils.ts:1731)                    │   │
│  │       ├─ normalizeToolResult() - normalize various formats           │   │
│  │       ├─ persistToolMedia() - store images/files as blobs            │   │
│  │       └─ Returns SanitizedToolResult with @blob:xyz references       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  SENDING TO LLM                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ContextManager.getFormattedMessages()                                │   │
│  │   └─ expandBlobReferences() (context/utils.ts:712)                   │   │
│  │       ├─ Resolves @blob:xyz → actual base64 data                     │   │
│  │       ├─ Filters by allowedMediaTypes (model capabilities)           │   │
│  │       └─ Returns expanded content ready for LLM                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Functions (context/utils.ts)

| Function | Line | Purpose |
|----------|------|---------|
| `sanitizeToolResult()` | 1731 | Main entry - sanitize any tool output |
| `normalizeToolResult()` | 1107 | Convert various formats to standard structure |
| `persistToolMedia()` | 1166 | Store images/files as blobs |
| `expandBlobReferences()` | 712 | Resolve @blob:xyz before sending to LLM |
| `countMessagesTokens()` | 445 | Estimate tokens including images |

### MCP Resource Handling

MCP tools can return various content types:

```typescript
// MCP can return:
{
  content: [
    { type: 'text', text: '...' },
    { type: 'image', data: 'base64...', mimeType: 'image/png' },
    { type: 'resource', uri: 'file:///path', mimeType: '...' },
  ]
}
```

`sanitizeToolResult()` handles all these, storing large content as blobs.

### Verification Steps for New Loop

1. **User Input Flow** - Already works, no changes needed
   - [ ] Verify images are stored as blobs via `processUserInput()`
   - [ ] Verify blob references persist correctly

2. **Tool Result Flow** - Needs verification with new execution point
   - [ ] Verify `addToolResult()` is called AFTER `addAssistantMessage()`
   - [ ] Verify MCP image results are stored as blobs
   - [ ] Verify blob references are returned (not raw base64)

3. **LLM Formatting Flow** - Already works, no changes needed
   - [ ] Verify `expandBlobReferences()` resolves all refs
   - [ ] Verify model capability filtering works
   - [ ] Verify images are sent as actual base64 to LLM

4. **Token Counting** - Needs verification
   - [ ] Verify image tokens estimated correctly (provider-specific)
   - [ ] Verify blob refs don't count as text tokens

### Changes Needed

**None for blob handling** - the existing infrastructure works. The only change is WHERE we call `addToolResult()` (in our loop instead of Vercel's callback).

```typescript
// Before (in execute callback):
execute: async (args, options) => {
    const result = await toolManager.executeTool(...);
    await contextManager.addToolResult(...);  // Called here
    return result;
}

// After (in our loop):
for (const toolCall of response.toolCalls) {
    const result = await toolManager.executeTool(...);
    await contextManager.addToolResult(...);  // Called here instead
}
```

---

## Tests Needed

### Unit Tests

#### 1. AgentExecutor Tests
**File**: `packages/core/src/agent/executor.test.ts`

```typescript
describe('AgentExecutor', () => {
    describe('single step execution', () => {
        it('should call LLM with maxSteps: 1');
        it('should return toolCalls when LLM wants tools');
        it('should persist assistant message before tool results');
        it('should execute tools in order');
        it('should continue loop when tools return');
        it('should terminate when no tool calls');
        it('should terminate when max steps reached');
    });

    describe('message ordering', () => {
        it('should persist: user → asst → tool (correct order)');
        it('should NOT persist: user → tool → asst (wrong order)');
        it('should handle multiple tool calls in single step');
    });

    describe('cancellation', () => {
        it('should abort on signal during streaming');
        it('should persist partial response on cancel');
        it('should let current tool finish before stopping');
        it('should not start new tools after abort');
    });

    describe('compression integration', () => {
        it('should check compression before each LLM call');
        it('should compress when over threshold');
        it('should use actual token count when available');
    });
});
```

#### 2. CompressionService Tests
**File**: `packages/core/src/context/compression.test.ts`

```typescript
describe('CompressionService', () => {
    describe('threshold detection', () => {
        it('should not compress under threshold');
        it('should compress over threshold');
        it('should use actual tokens when provided');
        it('should fall back to estimation');
    });

    describe('split point finding', () => {
        it('should split at assistant message boundary');
        it('should not split in middle of tool chain');
        it('should preserve last 30% of history');
    });

    describe('summary generation', () => {
        it('should generate LLM summary of old messages');
        it('should include key context in summary');
        it('should reject if summary increases tokens');
    });
});
```

#### 3. MessageQueueService Tests
**File**: `packages/core/src/agent/message-queue.test.ts`

```typescript
describe('MessageQueueService', () => {
    it('should enqueue messages');
    it('should dequeue in FIFO order');
    it('should return null when empty');
    it('should emit message:queued event');
    it('should report pending count');
});
```

#### 4. CancellationHandler Tests
**File**: `packages/core/src/agent/cancellation.test.ts`

```typescript
describe('CancellationHandler', () => {
    describe('state tracking', () => {
        it('should track idle state');
        it('should track streaming state');
        it('should track executing_tools state');
    });

    describe('partial response', () => {
        it('should accumulate text chunks');
        it('should track tool calls');
        it('should persist partial on cancel');
    });

    describe('abort handling', () => {
        it('should trigger abort controller');
        it('should return correct persisted state');
    });
});
```

### Integration Tests

#### 5. Full Loop Integration
**File**: `packages/core/src/agent/executor.integration.test.ts`

```typescript
describe('AgentExecutor Integration', () => {
    it('should complete simple text response');
    it('should handle single tool call');
    it('should handle multi-step tool chain');
    it('should handle MCP tool with image result');
    it('should compress during long conversation');
    it('should persist all messages to database');
    it('should recover from mid-execution crash');
});
```

#### 6. Blob Flow Integration
**File**: `packages/core/src/context/blob-flow.integration.test.ts`

```typescript
describe('Blob Flow Integration', () => {
    it('should store user image as blob');
    it('should store MCP image result as blob');
    it('should expand blob refs before LLM call');
    it('should count image tokens correctly');
    it('should filter unsupported media types');
});
```

### Test Fixtures Needed

```
packages/core/src/__fixtures__/
├── images/
│   ├── small-image.png      # < 50KB (for token estimation tests)
│   ├── large-image.png      # > 50KB
│   └── screenshot.png       # GameBoy-style for gaming agent tests
├── tool-results/
│   ├── mcp-image-response.json
│   ├── mcp-text-response.json
│   └── mcp-mixed-response.json
└── messages/
    ├── simple-conversation.json
    ├── tool-chain-conversation.json
    └── long-conversation.json  # For compression tests
```

---

## New Files Needed (REVISED - Option C: Minimal)

**Design Decision**: Extend existing services instead of creating many new files.
- Compression stays in ContextManager (add async method)
- Cancellation is inline in TurnExecutor (not separate file)
- Only 2 truly new files needed

### Turn Executor (llm/executor/) - Turn-level orchestration

```
packages/core/src/llm/executor/
├── turn-executor.ts               # NEW - Main turn loop with maxSteps:1
│                                  #     - Includes cancellation handling (inline)
│                                  #     - Includes tool execution
├── turn-executor.test.ts          # NEW - Unit tests
├── turn-executor.integration.test.ts # NEW - Integration tests
├── types.ts                       # NEW - Executor types
└── index.ts                       # NEW - Exports
```

**Note**: Cancellation is handled INLINE in TurnExecutor, not as a separate service.

### Message Queue (session/) - Session-level concern

```
packages/core/src/session/
├── message-queue.ts               # NEW - Queue service for user messages
├── message-queue.test.ts          # NEW - Unit tests
└── index.ts                       # UPDATE - Export queue
```

### Compression - EXTEND ContextManager (no new service)

```
packages/core/src/context/
├── compression/
│   ├── strategies/
│   │   ├── llm-summary.ts         # NEW - LLM-based summarization (optional, Phase 2)
│   │   └── prune-tool-outputs.ts  # NEW - OpenCode-style pruning (optional, Phase 2)
│   ├── middle-removal.ts          # EXISTS - Keep
│   ├── oldest-removal.ts          # EXISTS - Keep
│   └── types.ts                   # EXISTS - Extend
├── manager.ts                     # UPDATE - Add async compression method
└── utils.ts                       # KEEP - Blob handling stays here
```

**Note**: No separate CompressionService. ContextManager gets a new async method:
```typescript
// In ContextManager
async compressIfNeeded(): Promise<{ compressed: boolean; metadata?: CompressionMetadata }>
```

### LLM Service Updates

```
packages/core/src/llm/services/
├── vercel.ts                      # UPDATE - Use TurnExecutor
│                                  #        - Remove execute callbacks
│                                  #        - Remove internal loop logic
├── anthropic.ts                   # FUTURE - Could use executor pattern
├── openai.ts                      # FUTURE - Could use executor pattern
├── factory.ts                     # KEEP - No changes needed
└── types.ts                       # UPDATE - Add executor-related types
```

### Summary of Changes (Minimal)

| Type | Count | Location | Files |
|------|-------|----------|-------|
| NEW | 4 | llm/executor/ | turn-executor, types, tests, index |
| NEW | 2 | session/ | message-queue, tests |
| NEW | 0-2 | context/compression/strategies/ | (optional future: llm-summary, prune) |
| UPDATE | 3 | Various | vercel.ts, manager.ts, session/index.ts |
| KEEP | All | Various | Blob handling, tool implementations, tokenizers, formatters |

**Total new files: 6** (down from 12+ in original plan)

---

## Context Module Post-Migration Cleanup

### Current State Analysis

The `context/` module has 11 files, with `manager.ts` at 1207 lines doing too much:

```
context/
├── manager.ts          # 1207 lines - multiple responsibilities
├── utils.ts            # ~800 lines - helper functions (KEEP)
├── types.ts            # 179 lines - clean types (KEEP)
├── index.ts            # minimal exports (KEEP)
├── errors.ts           # error factory (KEEP)
├── error-codes.ts      # error codes (KEEP)
├── media-helpers.ts    # media detection (KEEP)
└── compression/
    ├── types.ts        # ICompressionStrategy (KEEP)
    ├── middle-removal.ts   # (KEEP)
    └── oldest-removal.ts   # (KEEP)
```

### manager.ts Responsibilities (Pre-Migration)

| Responsibility | Lines | Post-Migration |
|---------------|-------|----------------|
| Message history (add/get/reset) | ~200 | **KEEP** |
| User input processing (blobs) | ~100 | **KEEP** |
| Token counting (hybrid approach) | ~150 | **SIMPLIFY** |
| Compression - prepareStep | ~150 | **DELETE** |
| Compression - async | ~50 | **KEEP** |
| Message formatting | ~100 | **KEEP** |
| LLM response processing | ~50 | **DELETE** |
| Config, logging, misc | ~100 | **KEEP** |

### Methods to DELETE After TurnExecutor Migration

```typescript
// DELETE: Only exists for Vercel's sync prepareStep callback
compressMessagesForPrepareStep()  // ~150 lines
compressHistorySync()              // ~60 lines

// DELETE: TurnExecutor will persist messages directly
processLLMResponse()               // ~15 lines
processLLMStreamResponse()         // ~20 lines
```

**Why these can be deleted:**
- `compressMessagesForPrepareStep` is complex because it must:
  1. Parse provider-specific messages back to InternalMessage[]
  2. Compress synchronously (prepareStep is sync)
  3. Re-format back to provider format
- With TurnExecutor, compression happens BETWEEN steps on `InternalMessage[]` directly
- TurnExecutor handles message persistence, no need for `processLLMResponse`

### Token Tracking Simplification

**Current (complex):**
```typescript
private lastActualTokenCount: number = 0;
private lastActualTokenMessageCount: number = 0;
private compressionThreshold: number = 0.8;

// Complex hybrid logic tracking which messages correspond to actual counts
```

**After TurnExecutor (simple):**
```typescript
private compressionThreshold: number = 0.8;

// TurnExecutor passes actual token count after each step
// No need to track message counts - executor knows the step
async compressIfNeeded(actualTokens: number): Promise<CompressionResult>
```

### Post-Migration manager.ts

```
manager.ts: 1207 lines → ~950 lines (-250 lines)
```

Remaining responsibilities are cohesive:
- History management (add/get/reset messages)
- Message adding with blob handling
- Compression (async only, called by TurnExecutor)
- Token counting (simplified, actual counts from executor)
- Formatting (delegates to formatter)

### Files Summary

| File | Action | Reason |
|------|--------|--------|
| `manager.ts` | **SHRINK** | Delete prepareStep code, simplify token tracking |
| `utils.ts` | **KEEP** | Essential (sanitizeToolResult, expandBlobReferences) |
| `types.ts` | **KEEP** | Clean, well-documented |
| `compression/*.ts` | **KEEP** | Solid implementations |
| `media-helpers.ts` | **KEEP** | Used by utils |
| `errors.ts`, `error-codes.ts` | **KEEP** | Standard pattern |

### Migration Checklist

After TurnExecutor is working:

- [ ] Delete `compressMessagesForPrepareStep()` from manager.ts
- [ ] Delete `compressHistorySync()` from manager.ts
- [ ] Delete `processLLMResponse()` from manager.ts
- [ ] Delete `processLLMStreamResponse()` from manager.ts
- [ ] Simplify token tracking (remove `lastActualTokenMessageCount`)
- [ ] Add `compressIfNeeded(actualTokens: number)` method
- [ ] Update any tests that use deleted methods
- [ ] Verify compression still works via TurnExecutor

---

## LLM Services Architecture

### Current Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         LLM SERVICE FACTORY                              │
│  createLLMService(config, router, ...)                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  router === 'vercel'              router === 'in-built'                  │
│         │                                  │                             │
│         ▼                                  ▼                             │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │VercelLLMService │              │ OpenAIService   │                   │
│  │ - openai        │              │ AnthropicService│                   │
│  │ - anthropic     │              │                 │                   │
│  │ - google        │              │ (Direct SDK)    │                   │
│  │ - groq, xai...  │              │                 │                   │
│  └─────────────────┘              └─────────────────┘                   │
│         │                                  │                             │
│         ▼                                  ▼                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    ILLMService Interface                         │    │
│  │  - completeTask(text, options, image?, file?, stream?)          │    │
│  │  - getAllTools()                                                 │    │
│  │  - getConfig()                                                   │    │
│  │  - getContextManager()                                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Proposed Architecture (with TurnExecutor)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         LLM SERVICE FACTORY                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │VercelLLMService │              │ OpenAIService   │                   │
│  │                 │              │ AnthropicService│                   │
│  │  completeTask() │              │                 │                   │
│  │       │         │              │ (unchanged for  │                   │
│  │       ▼         │              │  now - Phase 2) │                   │
│  │  ┌───────────┐  │              │                 │                   │
│  │  │TurnExecutor│ │              └─────────────────┘                   │
│  │  │           │  │                                                     │
│  │  │ - loop    │  │  ◄── NEW: Manages turn with maxSteps:1             │
│  │  │ - tools   │  │                                                     │
│  │  │ - cancel  │  │                                                     │
│  │  └───────────┘  │                                                     │
│  └─────────────────┘                                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Points**:
- `TurnExecutor` lives inside `llm/executor/` because it's SDK-specific
- Only `VercelLLMService` uses it initially (Phase 1)
- Other services (`OpenAIService`, `AnthropicService`) can adopt it later
- The `ILLMService` interface stays the same - no breaking changes

---

## DextoAgent Integration

### Current Call Flow

```
DextoAgent.run(message, image?, file?, sessionId)
    │
    ▼
ChatSession.run(message, image?, file?, stream?)
    │
    ▼
ILLMService.completeTask(text, options, image?, file?, stream?)
    │
    ▼
VercelLLMService.streamText() / generateText()
    │
    ▼
Vercel SDK internal loop (execute callbacks)
```

### Proposed Call Flow

```
DextoAgent.run(message, image?, file?, sessionId)
    │
    ▼
ChatSession.run(message, image?, file?, stream?)
    │
    ▼
ILLMService.completeTask(text, options, image?, file?, stream?)
    │
    ▼
VercelLLMService.completeTask()
    │
    ▼
TurnExecutor.execute()                    ◄── NEW
    │
    ├── Loop: while (!terminated)
    │   │
    │   ├── 1. Check MessageQueue         ◄── NEW (session-level)
    │   │
    │   ├── 2. Compress if needed (async) ◄── IMPROVED
    │   │
    │   ├── 3. streamText({ maxSteps: 1 })
    │   │
    │   ├── 4. Persist assistant message
    │   │
    │   ├── 5. Execute tools manually     ◄── MOVED from callbacks
    │   │
    │   └── 6. Persist tool results
    │
    └── Return final response
```

### Changes to DextoAgent

**No changes required to DextoAgent itself** - the integration is transparent:
- `ChatSession` still calls `ILLMService.completeTask()`
- `completeTask()` now uses `TurnExecutor` internally
- Events still flow through `SessionEventBus`

### Changes to ChatSession

Minimal changes:
- Pass `MessageQueueService` to LLM service (for message queuing feature)
- Handle new events (`context:compressed`, `message:queued`)

```typescript
// session/chat-session.ts (additions)
export class ChatSession {
    private messageQueue: MessageQueueService;  // NEW

    async run(message: string, ...) {
        // If currently busy, queue the message
        if (this.llmService.isBusy()) {
            return this.messageQueue.enqueue(message);
        }
        // ... existing logic
    }
}
```

---

## @dexto/server Integration

### Current Server Flow

```
POST /message-stream
    │
    ▼
agent.stream(message, { sessionId, signal })
    │
    ▼
AsyncIterator<StreamingEvent>
    │
    ▼
streamSSE() → writes events to response
```

### New Events to Handle

The server routes (`packages/server/src/hono/routes/messages.ts`) already handle all events generically:

```typescript
// Current code - no changes needed
for await (const event of iterator) {
    await stream.writeSSE({
        event: event.name,
        data: JSON.stringify(event),
    });
}
```

**New events that will flow through**:
- `context:compressed` - When compression occurs
- `message:queued` - When message is queued (if busy)
- `message:dequeued` - When queued message is processed

### Cancellation Integration

Current cancellation flow works via `AbortController`:

```typescript
// messages.ts - already implemented
const abortController = new AbortController();
const { signal } = abortController;

const iterator = await agent.stream(message, { ..., signal });

// On stream close/error
abortController.abort();
```

**Enhancement needed**: The `TurnExecutor` will persist partial state on abort:

```typescript
// In TurnExecutor
async cancel(): Promise<CancellationResult> {
    this.abortController.abort();

    if (this.state === 'streaming' && this.partialText) {
        // Persist partial assistant message
        await this.contextManager.addAssistantMessage(
            this.partialText + ' [interrupted]'
        );
    }

    return { cancelled: true, state: this.state, partialText: this.partialText };
}
```

### New API Endpoints (Optional)

```typescript
// Future: packages/server/src/hono/routes/messages.ts

// Queue a message without waiting
POST /message-queue
  → { queued: true, position: number }

// Cancel current execution
POST /message-cancel
  → { cancelled: true, state: string, partialPersisted: boolean }

// Get queue status
GET /message-queue/status
  → { pending: number, messages: QueuedMessage[] }
```

---

## @dexto/client-sdk Integration

### Current SDK Flow

```typescript
import { createDextoClient, createMessageStream } from '@dexto/client-sdk';

const client = createDextoClient({ baseUrl: 'http://localhost:3001' });

// Streaming
const stream = createMessageStream(
    client.api['message-stream'].$post({ json: { message, sessionId } })
);

for await (const event of stream) {
    switch (event.name) {
        case 'llm:chunk': console.log(event.content); break;
        case 'llm:tool-call': console.log('Tool:', event.toolName); break;
        case 'llm:response': console.log('Done:', event.content); break;
    }
}
```

### New Events to Handle

```typescript
// streaming.ts - MessageStreamEvent already uses StreamingEvent from @dexto/core
export type MessageStreamEvent = StreamingEvent;

// New event types will be automatically available:
for await (const event of stream) {
    switch (event.name) {
        // Existing
        case 'llm:chunk': ...
        case 'llm:tool-call': ...
        case 'llm:response': ...

        // NEW events from TurnExecutor
        case 'context:compressed':
            console.log(`Compressed: ${event.originalTokens} → ${event.compressedTokens}`);
            break;

        case 'message:queued':
            console.log(`Message queued at position ${event.position}`);
            break;
    }
}
```

### New SDK Methods (Optional)

```typescript
// Future additions to client.ts

// Cancel current message
await client.api['message-cancel'].$post({ json: { sessionId } });

// Queue message (for busy agent)
await client.api['message-queue'].$post({ json: { message, sessionId } });

// Check queue status
const status = await client.api['message-queue'].status.$get({ query: { sessionId } });
```

---

## WebUI Integration

### Current WebUI Flow

```
ChatPage.tsx
    │
    ▼
useChatStore() / useMessages()
    │
    ├── POST /message-stream
    │
    └── Parse SSE events
        │
        ├── llm:thinking → Show thinking indicator
        ├── llm:chunk → Append to message
        ├── llm:tool-call → Show tool card
        ├── llm:tool-result → Update tool card
        └── llm:response → Finalize message
```

### New UI Elements Needed

1. **Compression Indicator**
   ```tsx
   // When context:compressed event received
   <Toast>
       Context compressed: {originalTokens} → {compressedTokens} tokens
   </Toast>
   ```

2. **Message Queue UI**
   ```tsx
   // When message:queued event received
   <QueueIndicator position={event.position} />

   // In input area when busy
   <InputArea
       disabled={isBusy}
       placeholder={isBusy ? "Agent is busy, message will be queued..." : "Type a message"}
   />
   ```

3. **Cancel Button**
   ```tsx
   // During streaming
   <CancelButton onClick={() => cancelMessage(sessionId)} />
   ```

### State Updates

```typescript
// packages/webui/src/stores/chat-store.ts (example additions)

interface ChatState {
    // Existing
    messages: Message[];
    isStreaming: boolean;

    // NEW
    queuedMessages: QueuedMessage[];
    compressionHistory: CompressionEvent[];
    partialResponse: string | null;
}

// Handle new events
function handleEvent(event: StreamingEvent) {
    switch (event.name) {
        case 'context:compressed':
            addCompressionEvent(event);
            break;

        case 'message:queued':
            addToQueue(event);
            break;

        case 'message:dequeued':
            removeFromQueue(event.messageId);
            break;
    }
}
```

---

## References

- [Vercel AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK 5 Blog Post](https://vercel.com/blog/ai-sdk-5)
- OpenCode source: `/Users/karaj/Projects/opencode`
- Gemini-CLI source: `/Users/karaj/Projects/gemini-cli`
