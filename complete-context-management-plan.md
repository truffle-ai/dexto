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

## References

- [Vercel AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK 5 Blog Post](https://vercel.com/blog/ai-sdk-5)
- OpenCode source: `/Users/karaj/Projects/opencode`
- Gemini-CLI source: `/Users/karaj/Projects/gemini-cli`
