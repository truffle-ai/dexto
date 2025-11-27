# Complete Context Management Plan v2

> **Status**: Draft v2
> **Created**: 2024-11-27
> **Updated**: 2024-11-27
> **Related Issues**: Message cancellation, message queuing, context compression
> **Based on**: Research from OpenCode and Gemini-CLI implementations

## Changes from v1

1. **Architecture Change**: Use `stopWhen: stepCountIs(1)` instead of `maxSteps: 1` without execute callbacks
2. **Stream Interception**: Add StreamProcessor for real-time persistence during Vercel SDK execution
3. **Compression**: Reactive (on overflow) using actual tokens, not percentage-based threshold
4. **Pruning**: Mark tool outputs with `compactedAt` instead of deletion
5. **Cleanup**: Adopt TC39 `defer()` pattern for cancellation
6. **Token Estimation**: Simple `length/4` for pruning decisions, actual tokens for compression

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

### OpenCode Approach (Primary Influence for v2)
- **Custom loop**: `loop(sessionID)` with `stopWhen: stepCountIs(1)` - ONE step at a time
- **Tool execution**: KEEPS execute callbacks, intercepts stream events for persistence
- **Compression**: Reactive on overflow using ACTUAL tokens from last step
- **Pruning**: Marks old tool outputs with `time.compacted`, returns placeholder text
- **Token counting**: `length/4` for pruning estimates, actual tokens for overflow check
- **Persistence**: Part-based, immediate updates via `Session.updatePart()`
- **Cancellation**: `defer()` cleanup pattern with abort signals (TC39 Explicit Resource Management)
- **Queue pattern**: Coalescing (all concurrent callers get same result)

### Gemini-CLI Approach
- **Custom loop**: `executeTurn()` in AgentExecutor class
- **Compression**: LLM summary at 50% threshold, preserve last 30%
- **Token counting**: Heuristic (ASCII ~0.25, non-ASCII ~1.3 tokens/char) + API fallback
- **Persistence**: File-based JSON with queued metadata pattern
- **Tool execution**: Parallel via `Promise.all()`
- **Cancellation**: AbortController with 60s grace period for recovery turns

### Vercel AI SDK (Current)
- **Internal loop**: `maxSteps` controls iterations, callbacks for hooks
- **Compression**: `prepareStep` (synchronous only)
- **Token counting**: Per-step in `onStepFinish`, cumulative in `totalUsage`
- **Tool execution**: `execute` callback, runs before `onStepFinish`

## Key Insight: `stopWhen: stepCountIs(1)`

Instead of removing execute callbacks (v1 approach), we can use `stopWhen: stepCountIs(1)`:

```typescript
streamText({
  tools: toolsWithExecuteCallbacks,  // KEEP callbacks
  stopWhen: stepCountIs(1),          // Control returns after 1 step
  // ...
})
```

This gives us:
- Tool execution still handled by Vercel SDK
- Control returns after each step (LLM call + tool executions)
- Real-time persistence via stream event interception
- Full control between steps for compression, queue checking, etc.

## Proposed Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEXTO AGENT LOOP (v2)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  using _ = defer(() => cleanup(sessionId));  // Auto-cleanup on exit        │
│                                                                             │
│  while (true) {                                                             │
│                                                                             │
│    // 1. MID-LOOP MESSAGE INJECTION (Claude Code feature)                   │
│    const newMsg = await messageQueue.dequeue();                             │
│    if (newMsg) await contextManager.addUserMessage(newMsg);                 │
│                                                                             │
│    // 2. REACTIVE COMPRESSION (after overflow detected)                     │
│    if (lastStepTokens && isOverflow(lastStepTokens, modelLimits)) {         │
│      await compressHistory();                                               │
│      continue;                                                              │
│    }                                                                        │
│                                                                             │
│    // 3. SINGLE STEP WITH STREAM INTERCEPTION                               │
│    const result = await streamProcessor.process(() =>                       │
│      streamText({                                                           │
│        stopWhen: stepCountIs(1),                                            │
│        tools: toolsWithExecuteCallbacks,                                    │
│        abortSignal: this.abortController.signal,                            │
│        messages: contextManager.getFormattedMessages(),                     │
│      })                                                                     │
│    );                                                                       │
│                                                                             │
│    // 4. CAPTURE ACTUAL TOKENS (for next iteration's overflow check)        │
│    lastStepTokens = result.usage;                                           │
│                                                                             │
│    // 5. CHECK TERMINATION                                                  │
│    if (result.finishReason !== 'tool-calls') break;                         │
│    if (this.abortController.signal.aborted) break;                          │
│    if (stepCount >= maxSteps) break;                                        │
│                                                                             │
│    // 6. PRUNE OLD TOOL OUTPUTS (mark, don't delete)                        │
│    await pruneOldToolOutputs();                                             │
│                                                                             │
│    stepCount++;                                                             │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Stream Processor (Real-time Persistence)

Intercepts all stream events and persists immediately:

```typescript
class StreamProcessor {
  private assistantMessage: AssistantMessage;
  private toolStates: Map<string, ToolState> = new Map();

  async process(
    streamFn: () => StreamTextResult<Record<string, AITool>>
  ): Promise<StreamProcessorResult> {
    const stream = streamFn();

    for await (const event of stream.fullStream) {
      this.abortSignal.throwIfAborted();

      switch (event.type) {
        case 'text-start':
          this.assistantMessage = await this.contextManager.createAssistantMessage();
          break;

        case 'text-delta':
          await this.contextManager.appendAssistantText(event.text);
          this.eventBus.emit('llm:chunk', { content: event.text });
          break;

        case 'tool-input-start':
          await this.contextManager.createToolPart(event.id, event.toolName, 'pending');
          break;

        case 'tool-call':
          await this.contextManager.updateToolState(event.toolCallId, 'running', event.input);
          this.eventBus.emit('llm:tool-call', { id: event.toolCallId, name: event.toolName });
          break;

        case 'tool-result':
          await this.contextManager.updateToolState(event.toolCallId, 'completed', event.output);
          this.eventBus.emit('llm:tool-result', { id: event.toolCallId, result: event.output });
          break;

        case 'tool-error':
          await this.contextManager.updateToolState(event.toolCallId, 'error', event.error);
          break;

        case 'finish-step':
          this.actualTokens = event.usage;
          await this.contextManager.finalizeAssistantMessage(event.finishReason);
          break;
      }
    }

    return {
      finishReason: this.finishReason,
      usage: this.actualTokens,
    };
  }
}
```

#### 2. Reactive Compression (Overflow-Based)

Triggers compression AFTER overflow is detected (using actual tokens from last step):

```typescript
function isOverflow(tokens: TokenUsage, model: ModelLimits): boolean {
  const contextLimit = model.contextWindow;
  const outputBuffer = Math.min(model.maxOutput, OUTPUT_TOKEN_MAX);
  const usable = contextLimit - outputBuffer;

  const used = tokens.inputTokens + tokens.cacheReadTokens;
  return used > usable;
}

async function compressHistory(): Promise<void> {
  // LLM-based summarization of old messages
  const summary = await generateSummary(this.getOldMessages());

  // Replace old messages with summary
  await this.contextManager.replaceWithSummary(summary);

  this.eventBus.emit('context:compressed', {
    originalTokens: this.lastTokenCount,
    strategy: 'llm-summary'
  });
}
```

#### 3. Mark-Don't-Delete Pruning

Preserves history while reducing token count:

```typescript
interface ToolResult {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  compactedAt?: number;  // NEW: timestamp when output was pruned
}

const PRUNE_PROTECT = 40_000;  // Keep last 40K tokens of tool outputs
const PRUNE_MINIMUM = 20_000;  // Only prune if we can save 20K+

async function pruneOldToolOutputs(): Promise<void> {
  const history = await this.getHistory();
  let totalToolTokens = 0;
  let prunedTokens = 0;
  const toPrune: ToolResult[] = [];

  // Go backwards through history
  for (const msg of [...history].reverse()) {
    if (msg.role === 'assistant' && msg.isSummary) break;  // Stop at summary

    for (const tool of msg.toolResults?.reverse() ?? []) {
      if (tool.status !== 'completed') continue;
      if (tool.compactedAt) break;  // Already pruned

      const tokens = estimateTokens(tool.output);  // length/4
      totalToolTokens += tokens;

      if (totalToolTokens > PRUNE_PROTECT) {
        prunedTokens += tokens;
        toPrune.push(tool);
      }
    }
  }

  // Only prune if significant savings
  if (prunedTokens > PRUNE_MINIMUM) {
    for (const tool of toPrune) {
      tool.compactedAt = Date.now();
      await this.updateToolResult(tool);
    }
  }
}

// When formatting for LLM
function formatToolOutput(tool: ToolResult): string {
  if (tool.compactedAt) {
    return '[Old tool result content cleared]';
  }
  return tool.output;
}
```

#### 4. Message Queue Service (Mid-Loop Injection)

True queue for Claude Code-style user guidance during task execution:

```typescript
class MessageQueueService {
  private queue: QueuedMessage[] = [];
  private eventBus: EventBus;

  // Called by API endpoint - returns immediately
  async enqueue(message: UserMessage): Promise<{ queued: true; position: number }> {
    const queuedMsg = {
      ...message,
      queuedAt: Date.now(),
      id: generateId(),
    };
    this.queue.push(queuedMsg);
    this.eventBus.emit('message:queued', { position: this.queue.length });
    return { queued: true, position: this.queue.length };
  }

  // Called by executor between steps
  async dequeue(): Promise<UserMessage | null> {
    const msg = this.queue.shift();
    if (msg) {
      this.eventBus.emit('message:dequeued', { id: msg.id });
    }
    return msg ?? null;
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  clear(): void {
    this.queue = [];
  }
}
```

#### 5. Cancellation with `defer()` Pattern

TC39 Explicit Resource Management for automatic cleanup:

```typescript
// util/defer.ts
export function defer<T extends () => void | Promise<void>>(
  fn: T
): { [Symbol.dispose]: () => void; [Symbol.asyncDispose]: () => Promise<void> } {
  return {
    [Symbol.dispose]() {
      fn();
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn());
    },
  };
}

// In executor
async execute(sessionId: string): Promise<ExecutorResult> {
  const abortController = new AbortController();

  // Automatic cleanup when scope exits (normal, throw, or return)
  using _ = defer(() => this.cleanup(sessionId, abortController));

  // ... loop logic ...
}

private cleanup(sessionId: string, controller: AbortController): void {
  controller.abort();
  this.messageQueue.clear();
  this.sessionStatus.set(sessionId, 'idle');
  // Reject any queued callbacks
  this.rejectPendingCallbacks(sessionId);
}
```

### Token Counting Strategy

**Two-tier approach:**

1. **Actual Tokens** (from API response) - for overflow detection
   ```typescript
   // After each step, capture from finish-step event
   case 'finish-step':
     this.actualTokens = {
       inputTokens: event.usage.inputTokens,
       outputTokens: event.usage.outputTokens,
       cacheReadTokens: event.usage.cachedInputTokens ?? 0,
     };
   ```

2. **Estimated Tokens** (`length/4`) - for pruning decisions only
   ```typescript
   function estimateTokens(text: string): number {
     return Math.max(0, Math.round((text || '').length / 4));
   }
   ```

### Message Flow

**Correct order with stream interception:**
```
user message
    │
    ▼
streamText({ stopWhen: stepCountIs(1) })
    │
    ├── text-start → createAssistantMessage()
    ├── text-delta → appendAssistantText()
    ├── tool-call → updateToolState('running')
    ├── [tool executes via callback]
    ├── tool-result → updateToolState('completed')
    └── finish-step → finalizeAssistantMessage()
    │
    ▼
Control returns to our loop
    │
    ▼
Check: overflow? queue? continue?
```

## Migration Path

### Phase 1: Stream Processor ✓
- [ ] Create StreamProcessor class
- [ ] Intercept all stream events
- [ ] Implement real-time persistence via ContextManager
- [ ] Test message ordering is correct

### Phase 2: `stopWhen` Integration
- [ ] Change from current approach to `stopWhen: stepCountIs(1)`
- [ ] Keep tool execute callbacks
- [ ] Verify control returns after each step
- [ ] Test tool execution still works

### Phase 3: Reactive Compression
- [ ] Implement `isOverflow()` check using actual tokens
- [ ] Add LLM-based summarization
- [ ] Trigger compression after overflow detected
- [ ] Test compression doesn't lose critical context

### Phase 4: Mark-Don't-Delete Pruning
- [ ] Add `compactedAt` field to tool results
- [ ] Implement `pruneOldToolOutputs()`
- [ ] Update `formatToolOutput()` to return placeholder
- [ ] Test pruning preserves history for debugging

### Phase 5: Message Queue
- [ ] Create MessageQueueService
- [ ] Add queue check in main loop
- [ ] Implement mid-loop message injection
- [ ] Add API endpoint for queued messages
- [ ] Test user guidance during task execution

### Phase 6: `defer()` Cleanup
- [ ] Implement defer utility
- [ ] Add to executor for automatic cleanup
- [ ] Test cleanup on normal exit, throw, and abort
- [ ] Verify no resource leaks

## Benefits

| Aspect | v1 Plan | v2 Plan (Revised) |
|--------|---------|-------------------|
| Tool Execution | Manual (rebuild) | SDK callbacks (simpler) |
| Persistence | After step | Real-time (stream events) |
| Compression Trigger | 80% threshold | Actual overflow (accurate) |
| Pruning | Delete messages | Mark with timestamp (preserves history) |
| Cleanup | Manual state machine | `defer()` pattern (automatic) |
| Message Queue | True queue | True queue (same) |
| Token Counting | Hybrid | Actual + estimate (simpler) |

## Open Questions

1. **Large tool results mid-loop**: How to handle if single tool result exceeds context? (See research needed)
2. **Compression validation**: Should we validate compression reduced tokens? (Gemini-CLI does this)
3. **Grace period**: Should we add recovery turn on timeout? (Gemini-CLI has 60s grace)
4. **Parallel tools**: Sequential or parallel tool execution? (Currently sequential via SDK)

## File Structure

```
packages/core/src/
├── llm/
│   ├── executor/
│   │   ├── stream-processor.ts      # NEW - Stream event interception
│   │   ├── turn-executor.ts         # NEW - Main loop with stopWhen
│   │   ├── types.ts                 # NEW - Executor types
│   │   └── index.ts
│   └── services/
│       └── vercel.ts                # UPDATE - Use TurnExecutor
├── context/
│   ├── manager.ts                   # UPDATE - Add compactedAt support
│   ├── compression/
│   │   ├── overflow.ts              # NEW - Overflow detection
│   │   └── pruning.ts               # NEW - Mark-don't-delete
│   └── utils.ts                     # UPDATE - formatToolOutput
├── session/
│   ├── message-queue.ts             # NEW - True queue service
│   └── index.ts
└── util/
    └── defer.ts                     # NEW - TC39 cleanup pattern
```

## References

- OpenCode source: `/Users/karaj/Projects/opencode`
- Gemini-CLI source: `/Users/karaj/Projects/gemini-cli`
- [Vercel AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- Research reports: `opencode-research-findings.md`, `gemini-cli-research-findings.md`
