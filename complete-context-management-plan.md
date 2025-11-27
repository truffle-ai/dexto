# Complete Context Management Plan v2

> **Status**: Draft v2
> **Created**: 2024-11-27
> **Updated**: 2024-11-27
> **Related Issues**: Messa ge cancellation, message queuing, context compression
> **Based on**: Research from OpenCode and Gemini-CLI implementations

## Changes from v1

1. **Architecture Change**: Use `stopWhen: stepCountIs(1)` instead of `maxSteps: 1` without execute callbacks
2. **Stream Observation**: Add StreamProcessor to OBSERVE stream events (NOT persist - execute callback handles that)
3. **Compression**: Pluggable strategy interface with reactive overflow detection as default
4. **Pruning**: Mark tool outputs with `compactedAt` instead of deletion
5. **Cleanup**: Adopt TC39 `defer()` pattern for cancellation
6. **Token Estimation**: Simple `length/4` for pruning decisions, actual tokens for compression
7. **Tool Output Truncation**: Prevent mid-loop overflow at source (like OpenCode)
8. **Queue Coalescing**: Multiple queued messages combined into single injection (supports multimodal)
9. **Delete Old Code**: Remove existing compression module entirely, rebuild from scratch (no backward compatibility)
10. **New Types**: Add `UserMessageContent`, `QueuedMessage`, `CoalescedResult` for type safety

## Migration Note

**Delete existing compression code** - we are rebuilding context management from scratch:
- Remove `packages/core/src/context/compression/` entirely
- Remove compression-related code from `ContextManager`
- No need for backward compatibility with existing strategies
- Fresh implementation based on OpenCode patterns

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
- **Tool output limits**: Bash truncates at 30K chars, Read limits to 2K lines × 2K chars/line

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

### What is a "Step" in Vercel AI SDK?

**A step = ONE LLM call + ALL tool executions from that call**

```
┌─────────────────────── ONE STEP ───────────────────────┐
│                                                        │
│  LLM Call                                              │
│    ↓                                                   │
│  Response: "I'll help. Let me use 3 tools..."         │
│    + tool_call_1 (bash)                               │
│    + tool_call_2 (read)                               │
│    + tool_call_3 (grep)                               │
│    ↓                                                   │
│  ALL tools execute (via callbacks)                    │
│    ↓                                                   │
│  Step finishes → control returns                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

From the Vercel AI SDK docs:
> "Each step involves the model processing messages and potentially making tool calls...
> Tool calls work as follows within each step: Model Generation → Tool Execution → Loop Decision"

**Key points:**
- LLM can return **multiple tool calls** in one response
- **ALL** those tool calls execute before step finishes
- Control returns to our loop only AFTER the complete step

### Mid-Step Overflow Handling

**We adopt OpenCode's approach: Trust tool truncation, check overflow AFTER each step.**

```
Step 1:
  LLM → returns 5 tool calls
  Tool 1 executes → output truncated at source (30K chars)
  Tool 2 executes → output truncated at source (2K lines)
  Tool 3 executes → ...
  Tool 4 executes → ...
  Tool 5 executes → ...

  Step finishes → capture actual token count
     ↓
  isOverflow(lastStepTokens)?
     YES → compress before next step
     NO  → continue
```

**Why this works:**
1. **Tool truncation prevents worst cases** - no single tool can add more than ~30K tokens
2. **Overflow detected after step** - triggers compression before next LLM call
3. **Simple and battle-tested** - same approach OpenCode uses in production

**Limitation:** If multiple large tool outputs in one step overflow context, the API call may fail. This is acceptable because:
- Tool truncation makes this unlikely
- API error is caught and surfaced to user
- Alternative (pre-step estimation) adds significant complexity

**If API fails due to context overflow:**
```typescript
} catch (e) {
  if (isContextOverflowError(e)) {
    // Force compression and retry
    await forceCompress();
    continue;  // Retry the step
  }
  throw e;
}
```

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
│    // 1. MID-LOOP MESSAGE INJECTION with coalescing                         │
│    const coalesced = messageQueue.dequeueAll();                             │
│    if (coalesced) {                                                         │
│      await contextManager.addUserMessage(coalesced.combinedContent);        │
│    }                                                                        │
│                                                                             │
│    // 2. COMPRESSION CHECK (strategy determines trigger)                    │
│    const compressed = await checkAndCompress();  // Uses ICompressionStrategy│
│    if (compressed) continue;                                                │
│                                                                             │
│    // 3. SINGLE STEP WITH STREAM INTERCEPTION                               │
│    const result = await streamProcessor.process(() =>                       │
│      streamText({                                                           │
│        stopWhen: stepCountIs(1),                                            │
│        tools: toolsWithExecuteCallbacks,  // Output truncated at source     │
│        abortSignal: this.abortController.signal,                            │
│        messages: contextManager.getFormattedMessages(),                     │
│      })                                                                     │
│    );                                                                       │
│                                                                             │
│    // 4. CAPTURE ACTUAL TOKENS (for overflow-based strategies)              │
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

#### 1. TurnExecutor (Main Agent Loop)

The TurnExecutor orchestrates the agent loop using `stopWhen: stepCountIs(1)`. This is the main entry point that replaces Vercel's internal loop with our controlled execution.

```typescript
class TurnExecutor {
  private streamProcessor: StreamProcessor;
  private messageQueue: MessageQueueService;
  private compressionStrategy: ICompressionStrategy;
  private abortController: AbortController;
  private contextManager: ContextManager;

  /**
   * Main agent execution loop.
   * Uses stopWhen: stepCountIs(1) to regain control after each step.
   */
  async execute(sessionId: string): Promise<ExecutorResult> {
    using _ = defer(() => this.cleanup(sessionId));

    let stepCount = 0;
    let lastStepTokens: TokenUsage | null = null;

    while (true) {
      // 1. Check for queued messages (mid-loop injection)
      const coalesced = this.messageQueue.dequeueAll();
      if (coalesced) {
        await this.contextManager.addUserMessage(coalesced.content);
      }

      // 2. Check for compression need (reactive, based on actual tokens)
      if (lastStepTokens && this.isOverflow(lastStepTokens)) {
        await this.compress();
        continue;  // Start fresh iteration after compression
      }

      // 3. Execute single step with stream processing
      const tools = this.createTools();
      const result = await this.streamProcessor.process(() =>
        streamText({
          model: this.model,
          stopWhen: stepCountIs(1),
          tools,
          abortSignal: this.abortController.signal,
          messages: await this.contextManager.getFormattedMessages(),
        })
      );

      // 4. Capture actual tokens for next iteration's overflow check
      lastStepTokens = result.usage;

      // 5. Check termination conditions
      if (result.finishReason !== 'tool-calls') break;
      if (this.abortController.signal.aborted) break;
      if (++stepCount >= this.maxSteps) break;

      // 6. Prune old tool outputs (mark with compactedAt)
      await this.pruneOldToolOutputs();
    }

    return { stepCount, usage: lastStepTokens, finishReason: result.finishReason };
  }

  /**
   * Creates tools with execute callbacks and toModelOutput.
   * Execute returns raw result, toModelOutput formats for LLM.
   */
  private createTools(): VercelToolSet {
    const tools = this.toolManager.getAllTools();
    return Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        name,
        {
          inputSchema: jsonSchema(tool.parameters),
          description: tool.description,
          execute: async (args, options) => {
            // Run tool, return raw result with inline images
            return this.toolManager.executeTool(name, args, this.sessionId);
          },
          toModelOutput: (result) => {
            // Format for LLM - sync, inline data already present
            return formatToolResultForLLM(result);
          },
        },
      ])
    );
  }

  private async cleanup(sessionId: string): Promise<void> {
    // Cancel pending operations, cleanup resources
    this.abortController.abort();
    await this.contextManager.finalizeSession(sessionId);
  }
}
```

**Key Responsibilities**:
- Owns the main `while(true)` loop
- Calls StreamProcessor for each step
- Handles compression decisions between steps (using actual tokens)
- Manages message queue injection between steps
- Applies pruning between steps
- Uses `defer()` for automatic cleanup on exit/error

#### 2. StreamProcessor (Handles ALL Persistence)

**Key Design Decision**: StreamProcessor handles ALL persistence including tool results.
This ensures correct message ordering since stream events arrive in order:
`text-delta` → `tool-call` → `tool-result` → `finish-step`

**Why this design**:
- Stream events arrive in correct order (assistant content → tool call → tool result)
- Single point of persistence ensures no ordering bugs
- Execute callback stays minimal (just runs tool)
- Verified from Vercel AI SDK source: `tool-result` event contains RAW output from execute

```typescript
class StreamProcessor {
  private assistantMessageId: string | null = null;
  private toolStates: Map<string, ToolState> = new Map();

  async process(
    streamFn: () => StreamTextResult<Record<string, AITool>>
  ): Promise<StreamProcessorResult> {
    const stream = streamFn();

    for await (const event of stream.fullStream) {
      this.abortSignal.throwIfAborted();

      switch (event.type) {
        case 'text-start':
          // Create assistant message FIRST (correct ordering)
          this.assistantMessageId = await this.contextManager.createAssistantMessage();
          break;

        case 'text-delta':
          // Append to assistant message, emit for UI
          await this.contextManager.appendAssistantText(this.assistantMessageId, event.text);
          this.eventBus.emit('llm:chunk', { content: event.text });
          break;

        case 'tool-call':
          // Create tool call record (pending state)
          await this.contextManager.createToolCall(this.assistantMessageId, {
            id: event.toolCallId,
            name: event.toolName,
            input: event.args,
            status: 'running',
          });
          this.eventBus.emit('llm:tool-call', { id: event.toolCallId, name: event.toolName });
          break;

        case 'tool-result':
          // PERSISTENCE HAPPENS HERE - event.output is RAW from execute
          const sanitized = await sanitizeToolResult(event.output);
          const withBlobRefs = await this.persistToolMedia(sanitized);
          const truncated = truncateToolOutput(withBlobRefs);

          await this.contextManager.updateToolResult(event.toolCallId, {
            status: 'completed',
            output: truncated,
          });
          this.eventBus.emit('llm:tool-result', { id: event.toolCallId, result: truncated });
          break;

        case 'tool-error':
          await this.contextManager.updateToolResult(event.toolCallId, {
            status: 'error',
            error: event.error,
          });
          break;

        case 'finish-step':
          // Capture actual token usage, finalize assistant message
          this.actualTokens = event.usage;
          await this.contextManager.finalizeAssistantMessage(this.assistantMessageId);
          break;
      }
    }

    return {
      finishReason: this.finishReason,
      usage: this.actualTokens,
    };
  }

  /**
   * Store images/files as blobs, replace with @blob: refs
   */
  private async persistToolMedia(result: SanitizedToolResult): Promise<SanitizedToolResult> {
    const blobStore = this.resourceManager.getBlobStore();
    const updatedContent = await Promise.all(
      result.content.map(async (part) => {
        if (part.type === 'image' && part.data) {
          const blobId = await blobStore.store(part.data, { mimeType: part.mimeType });
          return { ...part, image: `@blob:${blobId}` };
        }
        return part;
      })
    );
    return { ...result, content: updatedContent };
  }
}
```

**Tool Result Flow (v2 - StreamProcessor handles persistence)**:
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    TOOL RESULT FLOW (v2)                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Execute Callback (minimal - async):                                         │
│    1. Run tool via toolManager.executeTool()                                 │
│    2. Return raw result with inline images (base64)                          │
│    3. Does NOT persist, does NOT sanitize                                    │
│                                                                              │
│  toModelOutput (sync - formats for LLM):                                     │
│    1. Called by Vercel SDK when preparing next LLM call                      │
│    2. Format raw result for LLM consumption                                  │
│    3. Images already inline (base64), no expansion needed                    │
│    4. Returns { type: 'content', value: [...multimodal parts...] }           │
│                                                                              │
│  StreamProcessor (async - on tool-result event):                             │
│    1. Receive raw result (same object from execute)                          │
│    2. sanitizeToolResult() → normalize formats                               │
│    3. persistToolMedia() → store images as blobs, get @blob: refs            │
│    4. truncateToolOutput() → apply size limits                               │
│    5. contextManager.updateToolResult() → persist to history                 │
│    6. Emit llm:tool-result for UI                                            │
│                                                                              │
│  RESULT: LLM sees inline images, storage has @blob: refs                     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Vercel AI SDK Insight** (verified from source code):
- `tool-result` stream event contains RAW output from execute callback
- `toModelOutput` is called SEPARATELY when preparing messages for next LLM call
- This separation enables StreamProcessor to receive raw data for persistence
- Source: `ai/packages/ai/src/generate-text/execute-tool-call.ts:116-126`

### Multimodal Considerations (Dexto vs OpenCode)

**Key Difference**: Dexto requires LLM to SEE images (screenshot tools, image analysis).
OpenCode only stores images but sends TEXT to the LLM.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    OPENCODE vs DEXTO MULTIMODAL                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  OpenCode:                                                                   │
│    execute() → returns { output: "text", attachments: [images] }             │
│    toModelOutput() → returns { type: "text", value: result.output }          │
│    Result: LLM sees TEXT only, images stored but not sent                    │
│                                                                              │
│  Dexto:                                                                      │
│    execute() → returns { content: [text, images inline] }                    │
│    toModelOutput() → returns { type: "content", value: [multimodal] }        │
│    Result: LLM sees IMAGES, can analyze screenshots                          │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why `toModelOutput` matters for Dexto**:

`toModelOutput` is a Vercel AI SDK feature that transforms tool results before sending to LLM.
Dexto currently doesn't use it - execute callback returns content directly to Vercel SDK.

**New pattern with StreamProcessor persistence**:
1. `execute()` returns raw result with inline base64 images
2. `toModelOutput()` formats that raw result for LLM (sync, data already present)
3. `tool-result` event fires with raw result → StreamProcessor persists with @blob: refs

**Why this works**:
- `toModelOutput` is SYNC but doesn't need async blob expansion
- Images are already inline in the raw result from execute
- StreamProcessor handles async blob storage AFTER the fact
- LLM and storage both get what they need

**Implementation note**: Dexto will need to add `toModelOutput` to tool definitions:
```typescript
// In TurnExecutor.createTools()
{
  execute: async (args) => {
    // Returns raw result with inline images
    return toolManager.executeTool(name, args, sessionId);
  },
  toModelOutput: (result) => {
    // Sync: format inline content for LLM
    if (hasMultimodalContent(result)) {
      return {
        type: 'content',
        value: result.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image') return { type: 'media', data: part.data, mediaType: part.mimeType };
          return { type: 'text', text: '[unsupported content]' };
        }),
      };
    }
    return { type: 'text', value: summarizeToolContent(result) };
  },
}
```

#### 3. Tool Output Truncation (Prevent Mid-Loop Overflow)

**Problem**: A single tool result (e.g., `cat` on a huge file) could overflow context mid-loop before compression can react.

**Solution**: Truncate at the source, like OpenCode does:

```typescript
// Constants - configurable per agent
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 120_000;  // ~30K tokens
const DEFAULT_MAX_FILE_LINES = 2000;
const DEFAULT_MAX_LINE_LENGTH = 2000;

// Tool output wrapper - applied to ALL tool results
function truncateToolOutput(
  output: string,
  options: { maxChars?: number } = {}
): { output: string; truncated: boolean } {
  const maxChars = options.maxChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS;

  if (output.length <= maxChars) {
    return { output, truncated: false };
  }

  return {
    output: output.slice(0, maxChars) + '\n\n[Output truncated - exceeded maximum length]',
    truncated: true,
  };
}

// In StreamProcessor, wrap tool results
case 'tool-result':
  const { output, truncated } = truncateToolOutput(event.output.output);
  await this.contextManager.updateToolState(event.toolCallId, 'completed', {
    ...event.output,
    output,
    truncated,
  });
  break;
```

**Per-tool limits** (inherited from Dexto's existing tool config):
```yaml
# In agent config
tools:
  bash:
    maxOutputChars: 30000
  read:
    maxLines: 2000
    maxLineLength: 2000
  grep:
    maxMatches: 1000
```

#### 4. Pluggable Compression Strategy (Keep Dexto's Flexibility)

**Interface** - maintains Dexto's existing `ICompressionStrategy` pattern:

```typescript
/**
 * When to trigger compression check
 */
export type CompressionTrigger =
  | { type: 'threshold'; percentage: number }    // e.g., 80% of context
  | { type: 'overflow' }                          // After actual overflow (OpenCode style)
  | { type: 'manual' };                           // Only on explicit request

/**
 * Compression strategy interface (REPLACES existing Dexto interface)
 *
 * Note: We DELETE the old ICompressionStrategy and use this one.
 * No backward compatibility needed - complete replacement.
 */
export interface ICompressionStrategy {
  /** Human-readable name for logging/UI */
  readonly name: string;

  /** When this strategy should be triggered */
  readonly trigger: CompressionTrigger;

  /**
   * Compress history when triggered
   * @param history Current message history
   * @param tokenizer Tokenizer for counting
   * @param maxTokens Maximum allowed tokens
   * @returns Compressed history
   */
  compress(
    history: InternalMessage[],
    tokenizer: ITokenizer,
    maxTokens: number
  ): Promise<InternalMessage[]> | InternalMessage[];

  /** Optional: validate compression was effective */
  validate?(before: number, after: number): boolean;
}
```

**Default Strategy: Reactive Overflow (OpenCode-style)**

```typescript
export class ReactiveOverflowStrategy implements ICompressionStrategy {
  readonly name = 'reactive-overflow';
  readonly trigger: CompressionTrigger = { type: 'overflow' };

  constructor(
    private readonly llmService: ILLMService,
    private readonly options: {
      preserveLastNTurns?: number;  // Default: 2
      pruneProtectTokens?: number;  // Default: 40K
    } = {}
  ) {}

  async compress(
    history: InternalMessage[],
    tokenizer: ITokenizer,
    maxTokens: number
  ): Promise<InternalMessage[]> {
    // 1. Generate LLM summary of old messages
    const oldMessages = this.getMessagesToSummarize(history);
    const summary = await this.generateSummary(oldMessages);

    // 2. Replace old messages with summary message
    const summaryMessage: InternalMessage = {
      role: 'assistant',
      content: summary,
      metadata: { isSummary: true, summarizedAt: Date.now() }
    };

    // 3. Keep recent messages
    const recentMessages = this.getRecentMessages(history);

    return [summaryMessage, ...recentMessages];
  }

  validate(beforeTokens: number, afterTokens: number): boolean {
    // Compression should reduce tokens, not inflate
    return afterTokens < beforeTokens;
  }

  private async generateSummary(messages: InternalMessage[]): Promise<string> {
    // Use configured LLM to summarize
    const prompt = `Summarize this conversation, focusing on:
- What was accomplished
- Current state and context
- What needs to happen next

Conversation:
${this.formatMessages(messages)}`;

    return this.llmService.complete(prompt, { maxTokens: 2000 });
  }
}
```

**Alternative Strategies (can be swapped via config)**:

```typescript
// Existing Dexto strategy - simple middle removal (reimplemented)
export class MiddleRemovalStrategy implements ICompressionStrategy {
  readonly name = 'middle-removal';
  readonly trigger: CompressionTrigger = { type: 'threshold', percentage: 0.8 };
  // ... existing implementation
}

// Gemini-CLI style - proactive threshold
export class ProactiveThresholdStrategy implements ICompressionStrategyV2 {
  readonly name = 'proactive-threshold';
  readonly trigger: CompressionTrigger = { type: 'threshold', percentage: 0.5 };
  // ... LLM summary at 50% with 30% preservation
}
```

**Configuration in agent YAML**:

```yaml
context:
  compression:
    strategy: reactive-overflow  # or 'middle-removal', 'proactive-threshold'
    options:
      preserveLastNTurns: 2
      pruneProtectTokens: 40000
```

#### 5. Overflow Detection (Triggers Compression)

Used when strategy trigger is `overflow`:

```typescript
function isOverflow(tokens: TokenUsage, model: ModelLimits): boolean {
  const contextLimit = model.contextWindow;
  const outputBuffer = Math.min(model.maxOutput, OUTPUT_TOKEN_MAX);
  const usable = contextLimit - outputBuffer;

  const used = tokens.inputTokens + tokens.cacheReadTokens;
  return used > usable;
}

// In main loop - respects strategy's trigger type
async function checkAndCompress(): Promise<boolean> {
  const strategy = this.compressionStrategy;

  switch (strategy.trigger.type) {
    case 'overflow':
      if (!this.lastStepTokens) return false;
      if (!isOverflow(this.lastStepTokens, this.modelLimits)) return false;
      break;

    case 'threshold':
      const currentTokens = await this.estimateCurrentTokens();
      const threshold = this.modelLimits.contextWindow * strategy.trigger.percentage;
      if (currentTokens < threshold) return false;
      break;

    case 'manual':
      return false;  // Only compress on explicit request
  }

  // Trigger compression
  const beforeTokens = await this.countTokens();
  const compressed = await strategy.compress(
    this.history,
    this.tokenizer,
    this.modelLimits.contextWindow
  );

  // Validate if strategy supports it
  if (strategy.validate) {
    const afterTokens = await this.countTokens(compressed);
    if (!strategy.validate(beforeTokens, afterTokens)) {
      this.logger.warn('Compression validation failed - tokens may have increased');
      // Proceed anyway - LLM will attempt with current context
      // API error handling in main loop catches overflow if it occurs
      // Rationale: Hard failures hurt UX more than suboptimal compression
    }
  }

  this.history = compressed;
  return true;
}
```

#### 6. Mark-Don't-Delete Pruning

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

#### 7. Message Queue Service with Coalescing

True queue for Claude Code-style user guidance, with coalescing for multiple rapid messages:

```typescript
interface QueuedMessage {
  id: string;
  content: string;
  queuedAt: number;
  metadata?: Record<string, unknown>;
}

interface CoalescedMessage {
  messages: QueuedMessage[];
  combinedContent: string;
  firstQueuedAt: number;
  lastQueuedAt: number;
}

class MessageQueueService {
  private queue: QueuedMessage[] = [];
  private eventBus: EventBus;

  // Called by API endpoint - returns immediately
  async enqueue(message: UserMessage): Promise<{ queued: true; position: number }> {
    const queuedMsg: QueuedMessage = {
      id: generateId(),
      content: message.content,
      queuedAt: Date.now(),
      metadata: message.metadata,
    };
    this.queue.push(queuedMsg);
    this.eventBus.emit('message:queued', {
      position: this.queue.length,
      id: queuedMsg.id
    });
    return { queued: true, position: this.queue.length };
  }

  /**
   * Dequeue ALL pending messages and coalesce into single injection.
   * Called by executor between steps.
   *
   * If 3 messages are queued: "stop", "try X instead", "also check Y"
   * They become ONE combined message to the LLM.
   */
  dequeueAll(): CoalescedMessage | null {
    if (this.queue.length === 0) return null;

    const messages = [...this.queue];
    this.queue = [];

    // Combine into single message
    const combined = this.coalesce(messages);

    this.eventBus.emit('message:dequeued', {
      count: messages.length,
      ids: messages.map(m => m.id),
      coalesced: true,
    });

    return combined;
  }

  /**
   * Coalesce multiple messages into one.
   * Strategy: Join with clear separators, preserving order.
   */
  private coalesce(messages: QueuedMessage[]): CoalescedMessage {
    if (messages.length === 1) {
      return {
        messages,
        combinedContent: messages[0].content,
        firstQueuedAt: messages[0].queuedAt,
        lastQueuedAt: messages[0].queuedAt,
      };
    }

    // Multiple messages - combine with separator
    const combinedContent = messages
      .map((m, i) => {
        if (messages.length === 2) {
          return i === 0
            ? `First: ${m.content}`
            : `Also: ${m.content}`;
        }
        return `[${i + 1}] ${m.content}`;
      })
      .join('\n\n');

    return {
      messages,
      combinedContent,
      firstQueuedAt: messages[0].queuedAt,
      lastQueuedAt: messages[messages.length - 1].queuedAt,
    };
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
```

**Usage in main loop**:

```typescript
while (true) {
  // 1. CHECK FOR QUEUED MESSAGES - coalesce all pending
  const coalesced = messageQueue.dequeueAll();
  if (coalesced) {
    // Add as single user message with all guidance
    await contextManager.addUserMessage({
      role: 'user',
      content: coalesced.combinedContent,
      metadata: {
        coalesced: true,
        messageCount: coalesced.messages.length,
        originalMessages: coalesced.messages.map(m => m.id),
      }
    });

    // Log for debugging
    this.logger.info('Injected coalesced user guidance', {
      count: coalesced.messages.length,
      firstQueued: coalesced.firstQueuedAt,
      lastQueued: coalesced.lastQueuedAt,
    });
  }

  // 2. Continue with compression check, step execution, etc.
  // ...
}
```

**Example flow**:
```
User sends while agent is busy:
  t=0ms:  "stop what you're doing"
  t=50ms: "try a different approach"
  t=100ms: "use the newer API"

Agent loop iteration:
  → dequeueAll() returns:
    {
      messages: [msg1, msg2, msg3],
      combinedContent: "[1] stop what you're doing\n\n[2] try a different approach\n\n[3] use the newer API",
      ...
    }
  → Single user message injected into context
  → LLM sees all 3 pieces of guidance at once
```

#### 8. Cancellation with `defer()` Pattern

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

### Phase 0: Type Cleanup (Foundation)
- [ ] Delete old compression module (`packages/core/src/context/compression/`)
- [ ] Define new types: `UserMessageContent`, `QueuedMessage`, `CoalescedResult`
- [ ] Define new `ICompressionStrategy` interface with `trigger` field
- [ ] Add `compactedAt` field to tool result types

### Phase 1: Tool Output Truncation
- [ ] Implement `truncateToolOutput()` in `llm/executor/tool-output-truncator.ts`
- [ ] Add per-tool limit configuration to agent YAML schema
- [ ] Test truncation doesn't break tool results

### Phase 2: StreamProcessor WITH Persistence
- [ ] Create StreamProcessor class in `llm/executor/stream-processor.ts`
- [ ] Handle ALL persistence in `tool-result` event handler
- [ ] Include sanitization, blob storage, truncation
- [ ] Emit events for UI (`llm:chunk`, `llm:tool-call`, `llm:tool-result`)
- [ ] Test message ordering is correct (assistant → tool-call → tool-result)

### Phase 3: TurnExecutor Shell
- [ ] Create TurnExecutor class in `llm/executor/turn-executor.ts`
- [ ] Implement main loop with `stopWhen: stepCountIs(1)`
- [ ] Add `toModelOutput` to tool definitions (for multimodal)
- [ ] Integrate StreamProcessor
- [ ] Add abort signal handling
- [ ] Test tool execution still works

### Phase 4: Reactive Compression
- [ ] Implement `ReactiveOverflowStrategy` in `context/compression/reactive-overflow.ts`
- [ ] Add `isOverflow()` check using actual tokens from last step
- [ ] Implement LLM-based summarization
- [ ] Add `validate()` method for compression result validation
- [ ] Test compression triggers at correct time

### Phase 5: Pruning (compactedAt)
- [ ] Implement `pruneOldToolOutputs()` in TurnExecutor
- [ ] Update `formatToolOutput()` to return placeholder for compacted
- [ ] Test pruning preserves history for debugging

### Phase 6: MessageQueue with Multimodal
- [ ] Create MessageQueueService in `session/message-queue.ts`
- [ ] Implement multimodal coalescing (text + images + files)
- [ ] Handle edge cases (all images, large images as blobs)
- [ ] Add queue check in TurnExecutor main loop
- [ ] Modify `/api/message` to queue when busy
- [ ] Test user guidance during task execution

### Phase 7: defer() Cleanup
- [ ] Implement `defer()` utility in `util/defer.ts`
- [ ] Add to TurnExecutor for automatic cleanup
- [ ] Test cleanup on normal exit, throw, and abort
- [ ] Verify no resource leaks

### Phase 8: Integration + Migration
- [ ] Update `vercel.ts` to use TurnExecutor
- [ ] Delete old compression methods from ContextManager
- [ ] Update event emissions
- [ ] Full integration testing

## Benefits

| Aspect | v1 Plan | v2 Plan (Revised) |
|--------|---------|-------------------|
| Tool Execution | Manual (rebuild) | SDK callbacks (simpler) |
| Persistence | After step | Real-time (stream events) |
| Compression | Single strategy | Pluggable interface (flexible) |
| Compression Trigger | 80% threshold only | Strategy-defined (overflow, threshold, manual) |
| Mid-loop Overflow | Unhandled | Tool output truncation at source |
| Pruning | Delete messages | Mark with timestamp (preserves history) |
| Cleanup | Manual state machine | `defer()` pattern (automatic) |
| Message Queue | True queue | True queue with coalescing |
| Token Counting | Hybrid | Actual + estimate (simpler) |

## Resolved Questions

1. **Large tool results mid-loop**: ✅ RESOLVED - Truncate at source (like OpenCode: bash 30K chars, read 2K lines)
2. **Compression validation**: ✅ RESOLVED - Added `validate()` method to `ICompressionStrategyV2`
3. **Customizable compression**: ✅ RESOLVED - Pluggable strategy interface, OpenCode-style as default
4. **Validation fallback behavior**: ✅ RESOLVED - Log warning and proceed; API error handling catches overflow if it occurs (graceful degradation over hard failure)

## Open Questions

1. **Grace period**: Should we add recovery turn on timeout? (Gemini-CLI has 60s grace)
2. **Parallel tools**: Sequential or parallel tool execution? (Currently sequential via SDK)
3. **Coalescing format**: Is `[1] msg1\n\n[2] msg2` the best format for combined messages?

## File Structure

```
packages/core/src/
├── llm/
│   ├── executor/
│   │   ├── stream-processor.ts      # NEW - Stream event interception
│   │   ├── turn-executor.ts         # NEW - Main loop with stopWhen
│   │   ├── tool-output-truncator.ts # NEW - Prevent mid-loop overflow
│   │   ├── types.ts                 # NEW - Executor types
│   │   └── index.ts
│   └── services/
│       └── vercel.ts                # UPDATE - Use TurnExecutor
├── context/
│   ├── manager.ts                   # UPDATE - Add compactedAt support
│   ├── compression/
│   │   ├── types.ts                 # UPDATE - ICompressionStrategyV2
│   │   ├── reactive-overflow.ts     # NEW - OpenCode-style (default)
│   │   ├── middle-removal.ts        # EXISTING - Simple removal
│   │   ├── proactive-threshold.ts   # NEW - Gemini-CLI style (optional)
│   │   ├── overflow.ts              # NEW - Overflow detection
│   │   └── pruning.ts               # NEW - Mark-don't-delete
│   └── utils.ts                     # UPDATE - formatToolOutput
├── session/
│   ├── message-queue.ts             # NEW - True queue with coalescing
│   └── index.ts
└── util/
    └── defer.ts                     # NEW - TC39 cleanup pattern
```

---

## Blob/Storage/Resources Integration

### Current Flow (No Changes Needed)

The blob handling flow remains unchanged with v2. The key insight is that we're KEEPING execute callbacks, so blob handling still works the same way:

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
│  │ execute callback (STILL IN PLACE with v2)                            │   │
│  │   └─ ContextManager.addToolResult()                                  │   │
│  │       ├─ sanitizeToolResult() (context/utils.ts)                     │   │
│  │       ├─ persistToolMedia() - store images/files as blobs            │   │
│  │       └─ Returns SanitizedToolResult with @blob:xyz references       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  SENDING TO LLM                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ContextManager.getFormattedMessages()                                │   │
│  │   └─ expandBlobReferences() (context/utils.ts)                       │   │
│  │       ├─ Resolves @blob:xyz → actual base64 data                     │   │
│  │       ├─ Filters by allowedMediaTypes (model capabilities)           │   │
│  │       └─ Returns expanded content ready for LLM                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Functions (context/utils.ts)

| Function | Purpose |
|----------|---------|
| `sanitizeToolResult()` | Main entry - sanitize any tool output |
| `normalizeToolResult()` | Convert various formats to standard structure |
| `persistToolMedia()` | Store images/files as blobs |
| `expandBlobReferences()` | Resolve @blob:xyz before sending to LLM |
| `countMessagesTokens()` | Estimate tokens including images |

### Why No Changes Needed

With `stopWhen: stepCountIs(1)`, we KEEP execute callbacks:
- Tool execution still happens inside Vercel's step
- `addToolResult()` is still called in the execute callback
- StreamProcessor intercepts events for ORDERING, not execution
- Blob handling remains in execute callback (correct location)

The only change is that StreamProcessor ensures correct persistence ORDER:
1. Assistant message persisted (via `text-delta` events)
2. Tool results persisted (via execute callback + `tool-result` event)

### Verification Steps

- [ ] Verify images are stored as blobs via `processUserInput()`
- [ ] Verify MCP image results are stored as blobs in execute callback
- [ ] Verify `expandBlobReferences()` resolves all refs before LLM call
- [ ] Verify image tokens estimated correctly (provider-specific)

---

## Tests Needed

### Unit Tests

#### 1. TurnExecutor Tests
**File**: `packages/core/src/llm/executor/turn-executor.test.ts`

```typescript
describe('TurnExecutor', () => {
    describe('single step execution', () => {
        it('should call streamText with stopWhen: stepCountIs(1)');
        it('should return control after each step');
        it('should continue loop when finishReason is tool-calls');
        it('should terminate when finishReason is not tool-calls');
        it('should terminate when max steps reached');
        it('should terminate on abort signal');
    });

    describe('message queue integration', () => {
        it('should check queue at start of each iteration');
        it('should inject coalesced messages into context');
        it('should handle empty queue gracefully');
    });

    describe('compression integration', () => {
        it('should check overflow after each step');
        it('should trigger compression when overflow detected');
        it('should use actual tokens from API response');
        it('should retry step after compression');
    });

    describe('cleanup with defer()', () => {
        it('should cleanup on normal completion');
        it('should cleanup on error');
        it('should cleanup on abort');
        it('should clear message queue on cleanup');
    });
});
```

#### 2. StreamProcessor Tests
**File**: `packages/core/src/llm/executor/stream-processor.test.ts`

```typescript
describe('StreamProcessor', () => {
    describe('event handling', () => {
        it('should handle text-start event');
        it('should handle text-delta events');
        it('should handle tool-input-start event');
        it('should handle tool-call event');
        it('should handle tool-result event');
        it('should handle tool-error event');
        it('should handle finish-step event');
    });

    describe('persistence', () => {
        it('should persist assistant message on text events');
        it('should persist tool state changes');
        it('should capture actual token usage from finish-step');
    });

    describe('abort handling', () => {
        it('should check abort signal on each event');
        it('should throw on aborted signal');
    });

    describe('tool output truncation', () => {
        it('should truncate outputs exceeding maxChars');
        it('should mark truncated outputs');
        it('should respect per-tool limits');
    });
});
```

#### 3. MessageQueueService Tests
**File**: `packages/core/src/session/message-queue.test.ts`

```typescript
describe('MessageQueueService', () => {
    describe('enqueue', () => {
        it('should add message to queue');
        it('should return position in queue');
        it('should emit message:queued event');
    });

    describe('dequeueAll', () => {
        it('should return null when empty');
        it('should return single message as-is');
        it('should coalesce multiple messages');
        it('should clear queue after dequeue');
        it('should emit message:dequeued event');
    });

    describe('coalescing', () => {
        it('should format 2 messages with First/Also');
        it('should format 3+ messages with [1]/[2]/[3]');
        it('should preserve message order');
        it('should track original message IDs');
    });
});
```

#### 4. Compression Strategy Tests
**File**: `packages/core/src/context/compression/reactive-overflow.test.ts`

```typescript
describe('ReactiveOverflowStrategy', () => {
    describe('trigger', () => {
        it('should have overflow trigger type');
    });

    describe('compress', () => {
        it('should generate LLM summary of old messages');
        it('should preserve recent messages');
        it('should create summary message with metadata');
    });

    describe('validate', () => {
        it('should return true when tokens reduced');
        it('should return false when tokens increased');
    });
});

describe('isOverflow', () => {
    it('should return false when under limit');
    it('should return true when over usable limit');
    it('should account for output buffer');
    it('should include cache read tokens');
});
```

#### 5. Pruning Tests
**File**: `packages/core/src/context/compression/pruning.test.ts`

```typescript
describe('pruneOldToolOutputs', () => {
    it('should not prune when under PRUNE_PROTECT');
    it('should prune when over PRUNE_PROTECT');
    it('should only prune if savings exceed PRUNE_MINIMUM');
    it('should mark pruned tools with compactedAt');
    it('should stop at summary message');
    it('should preserve last 2 turns');
});

describe('formatToolOutput', () => {
    it('should return output when not compacted');
    it('should return placeholder when compacted');
});
```

#### 6. defer() Tests
**File**: `packages/core/src/util/defer.test.ts`

```typescript
describe('defer', () => {
    it('should call cleanup on normal scope exit');
    it('should call cleanup on throw');
    it('should call cleanup on return');
    it('should support async cleanup functions');
    it('should work with Symbol.dispose');
    it('should work with Symbol.asyncDispose');
});
```

### Integration Tests

#### 7. Full Loop Integration
**File**: `packages/core/src/llm/executor/turn-executor.integration.test.ts`

```typescript
describe('TurnExecutor Integration', () => {
    it('should complete simple text response');
    it('should handle single tool call');
    it('should handle multi-step tool chain');
    it('should handle MCP tool with image result');
    it('should compress during long conversation');
    it('should inject queued messages mid-loop');
    it('should persist all messages to database');
});
```

#### 8. Blob Flow Integration
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

---

## Integration Points

### @dexto/server Integration

The server routes handle all events generically via SSE:

```typescript
// Current code - no changes needed for event handling
for await (const event of iterator) {
    await stream.writeSSE({
        event: event.name,
        data: JSON.stringify(event),
    });
}
```

**New events that will flow through automatically:**
- `context:compressed` - When compression occurs
- `context:pruned` - When tool outputs are pruned
- `message:queued` - When message is queued (if busy)
- `message:dequeued` - When queued messages are injected

**API Changes - No New Endpoints Needed:**

The existing `/api/message` endpoint can be modified to queue when busy:

```typescript
// Modified /api/message endpoint
app.post('/api/message', async (req, res) => {
  const { sessionId, content } = req.body;
  const agentStatus = sessionManager.getStatus(sessionId);

  if (agentStatus === 'busy') {
    // Queue instead of rejecting
    const position = await messageQueue.enqueue({ sessionId, content });
    return res.json({
      ok: true,
      queued: true,
      position,
      message: `Message queued at position ${position}`,
    });
  }

  // Normal processing - start agent execution
  // ...existing message handling...
});
```

**Response when agent is busy:**
```json
{
  "ok": true,
  "queued": true,
  "position": 2,
  "message": "Message queued at position 2"
}
```

**Optional: Queue management endpoints** (only if explicitly needed later):
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/message/queue` | GET | Get queue status for session |
| `/api/message/queue` | DELETE | Clear queued messages |

### @dexto/client-sdk Integration

New events are automatically available via `StreamingEvent`:

```typescript
for await (const event of stream) {
    switch (event.name) {
        // Existing events
        case 'llm:chunk': ...
        case 'llm:tool-call': ...
        case 'llm:response': ...

        // NEW events
        case 'context:compressed':
            console.log(`Compressed: ${event.beforeTokens} → ${event.afterTokens}`);
            break;
        case 'message:queued':
            console.log(`Message queued at position ${event.position}`);
            break;
        case 'message:dequeued':
            console.log(`${event.count} queued messages injected`);
            break;
    }
}
```

**SDK behavior change:**
- `client.sendMessage()` now returns `{ queued: true, position: N }` if agent is busy
- UI can show "Message queued" indicator based on response

### WebUI Integration

**New UI elements needed:**

1. **Compression Indicator**
   ```tsx
   <Toast>Context compressed: {beforeTokens} → {afterTokens} tokens</Toast>
   ```

2. **Queue Indicator**
   ```tsx
   <QueueBadge count={queuedMessages.length} />
   ```

3. **Input State When Busy**
   ```tsx
   <InputArea
       placeholder={isBusy ? "Message will be queued..." : "Type a message"}
   />
   ```

---

## Context Module Post-Migration Cleanup

### Methods to DELETE from manager.ts

After TurnExecutor is working, these methods become obsolete:

```typescript
// DELETE: Only exists for Vercel's sync prepareStep callback
compressMessagesForPrepareStep()  // Complex sync compression
compressHistorySync()              // Sync wrapper

// DELETE: TurnExecutor handles this via StreamProcessor
processLLMResponse()               // No longer needed
processLLMStreamResponse()         // No longer needed
```

### Token Tracking Simplification

**Current (complex):**
```typescript
private lastActualTokenCount: number = 0;
private lastActualTokenMessageCount: number = 0;
// Complex hybrid logic tracking message counts
```

**After TurnExecutor (simple):**
```typescript
// TurnExecutor passes actual token count after each step
async checkOverflow(actualTokens: TokenUsage): Promise<boolean>
```

### Post-Migration Checklist

- [ ] Delete `compressMessagesForPrepareStep()` from manager.ts
- [ ] Delete `compressHistorySync()` from manager.ts
- [ ] Delete `processLLMResponse()` from manager.ts
- [ ] Delete `processLLMStreamResponse()` from manager.ts
- [ ] Simplify token tracking (remove message count tracking)
- [ ] Update tests that use deleted methods

---

## References

### Local Source Code
- OpenCode source: `/Users/karaj/Projects/opencode`
- Gemini-CLI source: `/Users/karaj/Projects/gemini-cli`
- Research reports: `opencode-research-findings.md`, `gemini-cli-research-findings.md`

### Vercel AI SDK Documentation
- [AI SDK Core: stepCountIs](https://ai-sdk.dev/docs/reference/ai-sdk-core/step-count-is) - Step counting function reference
- [Agents: Loop Control](https://ai-sdk.dev/docs/agents/loop-control) - How agent loops work, stopWhen, prepareStep
- [AI SDK Core: Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) - Tool execution and callbacks
- [Multi-Step & Generative UI](https://vercel.com/academy/ai-sdk/multi-step-and-generative-ui) - Multi-step patterns
- [How to build AI Agents with Vercel](https://docs.vercel.com/guides/how-to-build-ai-agents-with-vercel-and-the-ai-sdk) - Agent architecture guide

### Key Insights from Research
1. **Step definition**: One LLM call + all tool executions from that call
2. **Mid-step overflow**: Not handled - rely on tool truncation at source
3. **Overflow detection**: After step completes using actual token counts from API response
4. **Compression trigger**: Reactive (on overflow) using actual tokens, not estimates

---

## Implementation Summary

### New Components to Build

| # | Component | File | Description |
|---|-----------|------|-------------|
| 1 | **TurnExecutor** | `llm/executor/turn-executor.ts` | Main agent loop using `stopWhen: stepCountIs(1)` |
| 2 | **StreamProcessor** | `llm/executor/stream-processor.ts` | Real-time persistence via stream event interception |
| 3 | **ToolOutputTruncator** | `llm/executor/tool-output-truncator.ts` | Truncate tool outputs at source to prevent overflow |
| 4 | **ReactiveOverflowStrategy** | `context/compression/reactive-overflow.ts` | Default compression: LLM summary on overflow |
| 5 | **OverflowDetector** | `context/compression/overflow.ts` | Check if actual tokens exceed context limit |
| 6 | **Pruner** | `context/compression/pruning.ts` | Mark old tool outputs with `compactedAt` |
| 7 | **MessageQueueService** | `session/message-queue.ts` | True queue with coalescing for mid-loop injection |
| 8 | **defer()** | `util/defer.ts` | TC39 cleanup pattern for automatic resource cleanup |

### Features by Category

#### 🔄 Agent Loop Control
| Feature | Description | Inspired By |
|---------|-------------|-------------|
| Single-step execution | `stopWhen: stepCountIs(1)` - control after each LLM call | OpenCode |
| Stream event interception | Persist messages in real-time during stream | OpenCode |
| Correct message ordering | Assistant message → tool results (fixed) | OpenCode |
| Automatic cleanup | `defer()` pattern for guaranteed cleanup | OpenCode (TC39) |

#### 📦 Context Management
| Feature | Description | Inspired By |
|---------|-------------|-------------|
| Tool output truncation | Bash: 30K chars, Read: 2K lines - prevent overflow | OpenCode |
| Reactive overflow detection | Compress AFTER overflow using actual tokens | OpenCode |
| Mark-don't-delete pruning | `compactedAt` timestamp, placeholder text | OpenCode |
| Two-tier token counting | Actual (API) for overflow, estimate (length/4) for pruning | OpenCode |

#### 🗜️ Compression System
| Feature | Description | Inspired By |
|---------|-------------|-------------|
| Pluggable strategies | `ICompressionStrategyV2` interface | Dexto (existing) |
| Configurable triggers | `overflow`, `threshold`, `manual` | New |
| Compression validation | `validate(before, after)` - ensure tokens reduced | Gemini-CLI |
| LLM-based summarization | Generate summary of old messages | OpenCode |

#### 📬 Message Queue
| Feature | Description | Inspired By |
|---------|-------------|-------------|
| Mid-loop injection | User messages added between steps | Claude Code |
| Queue coalescing | Multiple messages → single combined injection | New |
| Immediate API response | `{ queued: true, position: N }` | New |

#### ⚙️ Configuration (agent YAML)
```yaml
context:
  compression:
    strategy: reactive-overflow  # or 'middle-removal', 'proactive-threshold'
    options:
      preserveLastNTurns: 2
      pruneProtectTokens: 40000

tools:
  bash:
    maxOutputChars: 30000
  read:
    maxLines: 2000
    maxLineLength: 2000
```

### Code to Delete

| Path | Reason |
|------|--------|
| `packages/core/src/context/compression/` | Rebuild from scratch |
| Compression code in `ContextManager` | Replace with new system |
| `prepareStep` compression logic in `vercel.ts` | Move to TurnExecutor |

### Event Bus Events (New/Updated)

| Event | Payload | When |
|-------|---------|------|
| `message:queued` | `{ id, position }` | User message added to queue |
| `message:dequeued` | `{ count, ids, coalesced }` | Messages injected into context |
| `context:compressed` | `{ strategy, beforeTokens, afterTokens }` | After compression completes |
| `context:pruned` | `{ count, tokensSaved }` | After tool outputs pruned |

### API Endpoints

**No new endpoints required.** The existing `/api/message` endpoint is modified to:
- Queue messages when agent is busy (returns `{ queued: true, position: N }`)
- Process normally when agent is idle

**Optional endpoints** (implement only if needed):
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/message/queue` | GET | Get current queue status |
| `/api/message/queue` | DELETE | Clear queue |

### Migration Checklist

- [ ] Delete old compression module (`packages/core/src/context/compression/`)
- [ ] Implement TurnExecutor with `stopWhen: stepCountIs(1)`
- [ ] Implement StreamProcessor with ALL persistence
- [ ] Add `toModelOutput` to tool definitions (for multimodal)
- [ ] Add tool output truncation
- [ ] Implement ReactiveOverflowStrategy (default)
- [ ] Add `compactedAt` field and pruning logic
- [ ] Implement MessageQueueService with coalescing (multimodal support)
- [ ] Add `defer()` utility
- [ ] Update `vercel.ts` to use new TurnExecutor
- [ ] Modify `/api/message` to queue when busy
- [ ] Update agent YAML schema for compression config
- [ ] Write tests for all new components
