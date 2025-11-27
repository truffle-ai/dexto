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

## New Files Needed

### Core Agent Loop

```
packages/core/src/agent/
├── executor.ts                    # NEW - Main agent loop
├── executor.test.ts               # NEW - Unit tests
├── executor.integration.test.ts   # NEW - Integration tests
├── types.ts                       # UPDATE - Add executor types
└── index.ts                       # UPDATE - Export executor
```

### Message Queue

```
packages/core/src/agent/
├── message-queue.ts               # NEW - Queue service
├── message-queue.test.ts          # NEW - Unit tests
└── index.ts                       # UPDATE - Export queue
```

### Cancellation

```
packages/core/src/agent/
├── cancellation.ts                # NEW - Cancellation handler
├── cancellation.test.ts           # NEW - Unit tests
└── index.ts                       # UPDATE - Export handler
```

### Compression (Refactor)

```
packages/core/src/context/
├── compression/
│   ├── service.ts                 # NEW - Extracted compression logic
│   ├── service.test.ts            # NEW - Unit tests
│   ├── strategies/
│   │   ├── llm-summary.ts         # NEW - LLM-based summarization
│   │   ├── prune-tool-outputs.ts  # NEW - OpenCode-style pruning
│   │   └── types.ts               # NEW - Strategy interface
│   └── index.ts                   # NEW - Exports
├── manager.ts                     # UPDATE - Use new compression service
└── utils.ts                       # KEEP - Blob handling stays here
```

### LLM Service Updates

```
packages/core/src/llm/services/
├── vercel.ts                      # UPDATE - Remove execute callbacks
│                                  #        - Use executor instead
│                                  #        - Remove prepareStep/onStepFinish
└── base.ts                        # UPDATE - Add executor integration
```

### Fixtures

```
packages/core/src/__fixtures__/
├── images/                        # NEW - Test images
├── tool-results/                  # NEW - MCP response fixtures
└── messages/                      # NEW - Conversation fixtures
```

### Summary of Changes

| Type | Count | Files |
|------|-------|-------|
| NEW | 12 | executor, queue, cancellation, compression service, strategies, fixtures |
| UPDATE | 5 | agent/types, agent/index, manager.ts, vercel.ts, base.ts |
| KEEP | All | Blob handling, tool implementations, tokenizers, formatters |

---

## References

- [Vercel AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK 5 Blog Post](https://vercel.com/blog/ai-sdk-5)
- OpenCode source: `/Users/karaj/Projects/opencode`
- Gemini-CLI source: `/Users/karaj/Projects/gemini-cli`
