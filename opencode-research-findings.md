# OpenCode Context Management Research Report

## Executive Summary

OpenCode implements a sophisticated agentic loop with efficient context compression, immediate persistence, and elegant cancellation handling. Their approach emphasizes **part-based updates via Session.updatePart()**, **auto-triggered compaction**, and **streaming-aware message ordering**. This report provides detailed findings suitable for informing Dexto's context management architecture.

---

## 1. Session/Loop Architecture

### Core Loop Function

**Location:** `/packages/opencode/src/session/prompt.ts`, lines 235-635

The `loop(sessionID)` function implements the main agentic loop with these key characteristics:

```typescript
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  const abort = start(sessionID)
  if (!abort) {
    // Queue callbacks if loop already running
    return new Promise<MessageV2.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))  // Cleanup on exit

  let step = 0
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    log.info("loop", { step, sessionID })
    if (abort.aborted) break
    
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
    
    // 1. Detect last user/assistant messages
    // 2. Check exit conditions
    // 3. Process pending tasks (subtasks, compaction)
    // 4. Normal LLM processing via streamText()
  }
})
```

### Key Loop Decisions (Lines 246-278)

1. **Exit Condition Detection:**
   - Checks if last assistant message is finished AND comes before last user message
   - Finish types that trigger exit: `"text"`, `"end_turn"`, `"stop_sequence"` (not `"tool-calls"`)
   - Ensures no pending tool calls before exiting

2. **Loop Steps:**
   - **Step 1:** Ensure title generation (async, non-blocking)
   - **Subsequent steps:** Full LLM processing with tools

3. **Async Summarization:**
   ```typescript
   if (step === 1) {
     SessionSummary.summarize({
       sessionID: sessionID,
       messageID: lastUser.id,
     })  // Async, doesn't block loop
   }
   ```

### Queue Pattern for Concurrent Requests

The loop manages concurrent requests by:
1. Checking if loop already running via `state()[sessionID]`
2. Queueing resolve/reject callbacks if already busy
3. All queued requests get resolved with the same response
4. Prevents N concurrent LLM calls for same session

---

## 2. Compression Strategy

### Auto-Triggered Compaction

**Location:** `/packages/opencode/src/session/compaction.ts`

#### Overflow Detection (Lines 32-40)

```typescript
export function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: ModelsDev.Model }) {
  if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) return false
  const context = input.model.limit.context
  if (context === 0) return false
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
  const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
  const usable = context - output
  return count > usable
}
```

**Triggers in Loop:** After assistant finishes and hasn't triggered compaction yet:
```typescript
if (
  lastFinished &&
  lastFinished.summary !== true &&
  SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model: model.info })
) {
  await SessionCompaction.create({
    sessionID,
    agent: lastUser.agent,
    model: lastUser.model,
    auto: true,
  })
  continue  // Loop continues with compaction
}
```

#### Compression Process (Lines 88-229)

The compaction flow:
1. **Creates assistant message** with `summary: true` flag
2. **Calls LLM** with all messages up to that point
3. **LLM generates summary** focused on: "what we did, what we're doing, which files, what we'll do next"
4. **Creates follow-up user message** to trigger continuation
5. **Loop continues** from the summary

Key: The summary is a **full assistant message**, not metadata - it preserves conversational flow.

### Pruning Strategy

**Location:** Lines 42-86

```typescript
export const PRUNE_MINIMUM = 20_000      // Only prune if >20k tokens
export const PRUNE_PROTECT = 40_000      // Keep last 40k tokens

export async function prune(input: { sessionID: string }) {
  let total = 0
  let pruned = 0
  const toPrune = []
  let turns = 0

  loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = msgs[msgIndex]
    if (msg.info.role === "user") turns++
    if (turns < 2) continue    // Protect last 2 user turns
    if (msg.info.role === "assistant" && msg.info.summary) break  // Stop at summary
    
    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = msg.parts[partIndex]
      if (part.type === "tool" && part.state.status === "completed") {
        if (part.state.time.compacted) break  // Already compacted
        const estimate = Token.estimate(part.state.output)
        total += estimate
        if (total > PRUNE_PROTECT) {
          pruned += estimate
          toPrune.push(part)  // Mark tool output for pruning
        }
      }
    }
  }
  
  if (pruned > PRUNE_MINIMUM) {
    for (const part of toPrune) {
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)  // Immediate update
    }
  }
}
```

**Strategy:** Goes backward through history, marks old tool outputs as "compacted" rather than deleting. Preserves full message structure for debugging/auditing.

---

## 3. Token Counting Implementation

**Location:** `/packages/opencode/src/util/token.ts`

```typescript
export namespace Token {
  const CHARS_PER_TOKEN = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }
}
```

**Simple but effective:** Uses `length/4` formula, same as GPT-3 heuristic.

### Token Tracking in Messages

**Location:** `/packages/opencode/src/session/message-v2.ts`, lines 188-196

```typescript
export const StepFinishPart = PartBase.extend({
  type: z.literal("step-finish"),
  reason: z.string(),
  snapshot: z.string().optional(),
  cost: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
})
```

Each step tracks:
- Input tokens
- Output tokens
- Reasoning tokens (for models like Claude with extended thinking)
- Cache read/write tokens

**Usage in Overflow Check:**
```typescript
const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
```

---

## 4. Persistence Model: Part-Based Immediate Updates

### Session Update Pattern

**Location:** `/packages/opencode/src/session/prompt.ts`, throughout

OpenCode uses an elegant **update, then modify, then update again** pattern:

```typescript
// 1. Create message first
const assistantMessage = (await Session.updateMessage({
  id: Identifier.ascending("message"),
  parentID: lastUser.id,
  role: "assistant",
  // ... other fields
  sessionID,
})) as MessageV2.Assistant

// 2. Create part within that message
let part = (await Session.updatePart({
  id: Identifier.ascending("part"),
  messageID: assistantMessage.id,
  sessionID: assistantMessage.sessionID,
  type: "tool",
  callID: ulid(),
  tool: TaskTool.id,
  state: {
    status: "running",
    input: { ... },
    time: { start: Date.now() },
  },
})) as MessageV2.ToolPart

// 3. Execute tool with callbacks to update progress
const result = await taskTool.execute(
  { ... },
  {
    sessionID: sessionID,
    abort,
    async metadata(input) {
      await Session.updatePart({
        ...part,
        type: "tool",
        state: {
          ...part.state,
          ...input,  // Merge metadata
        },
      })
    },
  },
)

// 4. Update part with final result
await Session.updatePart({
  ...part,
  state: {
    status: "completed",
    input: part.state.input,
    title: result.title,
    metadata: result.metadata,
    output: result.output,
    time: { ...part.state.time, end: Date.now() },
  },
})
```

### Key Characteristics

1. **Immediate Writes:** Each `Session.updatePart()` is an immediate database/storage write
2. **Partial Updates:** Can update just the fields that changed
3. **No Batching:** Updates flow immediately to storage
4. **Streaming Compatible:** Text parts use delta pattern:
   ```typescript
   await Session.updatePart({
     part: currentText,
     delta: value.text,  // Only the new delta sent
   })
   ```

### Message Types Tracked

From `/packages/opencode/src/session/message-v2.ts`:

- **TextPart:** Streaming text with optional synthetic flag
- **ReasoningPart:** Extended thinking tokens
- **ToolPart:** Tool execution with state transitions (pending → running → completed/error)
- **FilePart:** Attachments from tool results
- **StepStartPart/StepFinishPart:** Marks loop iterations with snapshots
- **PatchPart:** File diffs computed after step
- **CompactionPart:** Marks where compaction occurred
- **SubtaskPart:** Delegate to subagent

---

## 5. Cancellation: The `defer()` Pattern

### Implementation

**Location:** `/packages/opencode/src/util/defer.ts`

```typescript
export function defer<T extends () => void | Promise<void>>(
  fn: T,
): T extends () => Promise<void> ? { [Symbol.asyncDispose]: () => Promise<void> } : { [Symbol.dispose]: () => void } {
  return {
    [Symbol.dispose]() {
      fn()
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  } as any
}
```

This implements **TypeScript's `using` statement** (TC39 Explicit Resource Management).

### Usage in Loop

**Location:** `/packages/opencode/src/session/prompt.ts`, line 244

```typescript
using _ = defer(() => cancel(sessionID))

// Rest of loop code...
```

When the block exits (normally or via throw/abort), cleanup happens automatically.

### Cancellation Implementation

**Location:** `/packages/opencode/src/session/prompt.ts`, lines 221-233

```typescript
export function cancel(sessionID: string) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) return
  match.abort.abort()  // Signal AbortController
  for (const item of match.callbacks) {
    item.reject()      // Reject queued requests
  }
  delete s[sessionID]  // Clean state
  SessionStatus.set(sessionID, { type: "idle" })
  return
}
```

### Abort Signal Flow

1. **Created at loop start:**
   ```typescript
   const abort = start(sessionID)  // Creates AbortController
   ```

2. **Passed to all async operations:**
   ```typescript
   streamText({
     abortSignal: abort,
     // ...
   })
   
   await item.execute(args, {
     abort,  // Passed to tool execution
   })
   ```

3. **Checked in processor:**
   ```typescript
   input.abort.throwIfAborted()  // Throws if aborted
   ```

4. **Propagates to cleanup:**
   ```typescript
   using _ = defer(() => cancel(sessionID))
   ```

**Result:** Clean, composable cancellation without try/catch everywhere.

---

## 6. Tool Execution Pattern

### Tool Resolution and Setup

**Location:** `/packages/opencode/src/session/prompt.ts`, lines 666-816

```typescript
async function resolveTools(input: {
  agent: Agent.Info
  model: { providerID: string; modelID: string }
  sessionID: string
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
}) {
  const tools: Record<string, AITool> = {}
  const enabledTools = pipe(
    input.agent.tools,
    mergeDeep(await ToolRegistry.enabled(...)),
    mergeDeep(input.tools ?? {}),
  )
  
  for (const item of await ToolRegistry.tools(...)) {
    if (Wildcard.all(item.id, enabledTools) === false) continue
    
    tools[item.id] = tool({
      id: item.id,
      description: item.description,
      inputSchema: jsonSchema(schema),
      async execute(args, options) {
        // Plugin hooks
        await Plugin.trigger("tool.execute.before", ...)
        
        // Execute tool
        const result = await item.execute(args, {
          sessionID: input.sessionID,
          abort: options.abortSignal!,
          messageID: input.processor.message.id,
          callID: options.toolCallId,
          metadata: async (val) => {
            // Progress update callback
            const match = input.processor.partFromToolCall(options.toolCallId)
            if (match && match.state.status === "running") {
              await Session.updatePart({
                ...match,
                state: {
                  title: val.title,
                  metadata: val.metadata,
                  status: "running",
                  input: args,
                  time: { start: Date.now() },
                },
              })
            }
          },
        })
        
        // Plugin hooks
        await Plugin.trigger("tool.execute.after", ...)
        return result
      },
      toModelOutput(result) {
        return { type: "text", value: result.output }
      },
    })
  }
}
```

### Execution Inside Loop

**Key insight:** Tools execute **inside the LLM streaming loop**, not via separate callbacks.

The `streamText()` call from the `ai` SDK handles tool execution automatically:

```typescript
const result = await processor.process(() =>
  streamText({
    messages: [...system, ...MessageV2.toModelMessage(msgs)],
    tools,  // All tools passed here
    model: wrapLanguageModel({ model: model.language, middleware: [...] }),
  }),
)
```

### Tool Call Processing

**Location:** `/packages/opencode/src/session/processor.ts`, lines 41-376

Tool calls flow through the stream processor:

```typescript
case "tool-call": {
  const match = toolcalls[value.toolCallId]
  if (match) {
    const part = await Session.updatePart({
      ...match,
      tool: value.toolName,
      state: {
        status: "running",
        input: value.input,
        time: { start: Date.now() },
      },
    })
    toolcalls[value.toolCallId] = part
  }
  break
}

case "tool-result": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: value.input,
        output: value.output.output,
        metadata: value.output.metadata,
        title: value.output.title,
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
        attachments: value.output.attachments,
      },
    })
    delete toolcalls[value.toolCallId]
  }
  break
}
```

### Special Cases: Subtasks and Compaction

These are **not real tools** but pseudo-tasks created as special parts:

```typescript
if (task?.type === "subtask") {
  const taskTool = await TaskTool.init()
  // ... create assistant message and tool part ...
  const result = await taskTool.execute(
    { prompt, description, subagent_type: task.agent },
    { sessionID, abort, async metadata(...) {...} },
  )
  // ... update with result ...
  continue  // Loop continues to process more tasks
}
```

---

## 7. Message Ordering: Ensuring Assistant Before Tool Results

### The Challenge

Streaming LLMs produce:
1. Assistant message (thinking, planning)
2. Tool calls (references to available tools)
3. Tool results (responses from executing tools)
4. More assistant reasoning

Must be ordered: Assistant → Tool Calls → Tool Results → Assistant

### Solution: Stream Processor State Machine

**Location:** `/packages/opencode/src/session/processor.ts`, lines 22-380

Uses a map to track tool calls by ID:

```typescript
const toolcalls: Record<string, MessageV2.ToolPart> = {}

// When tool call starts
case "tool-input-start":
  const part = await Session.updatePart({
    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: { status: "pending", input: {}, raw: "" },
  })
  toolcalls[value.id] = part as MessageV2.ToolPart
  break

// When tool call completes
case "tool-result": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        output: value.output.output,
        // ...
      },
    })
    delete toolcalls[value.toolCallId]  // Track as complete
  }
  break
}
```

### Text Ordering

Text (from assistant or tool results) is also accumulated:

```typescript
case "text-start":
  currentText = {
    id: Identifier.ascending("part"),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "text",
    text: "",
    time: { start: Date.now() },
  }
  break

case "text-delta":
  if (currentText) {
    currentText.text += value.text
    if (currentText.text)
      await Session.updatePart({
        part: currentText,
        delta: value.text,  // Delta for real-time UI
      })
  }
  break

case "text-end":
  if (currentText) {
    currentText.text = currentText.text.trimEnd()
    currentText.time = { start: Date.now(), end: Date.now() }
    await Session.updatePart(currentText)
  }
  currentText = undefined
  break
```

**Result:** All parts are created in message store in the order streamed, with tool calls staying between planning and results.

---

## 8. Critical Code Locations Summary

| Component | File | Lines | Key Functions |
|-----------|------|-------|---|
| **Main Loop** | `prompt.ts` | 235-635 | `loop()`, `cancel()` |
| **Compression** | `compaction.ts` | 32-229 | `isOverflow()`, `process()`, `prune()` |
| **Tool Execution** | `processor.ts` | 41-376 | Stream event handlers (tool-call, tool-result) |
| **Persistence** | `prompt.ts` | 297-400 | `Session.updateMessage()`, `Session.updatePart()` |
| **Token Counting** | `token.ts` | 1-8 | `estimate()` |
| **Cancellation** | `defer.ts` | 1-13 | `defer()` with Symbol.dispose |
| **Message Schema** | `message-v2.ts` | 150-280 | Part types: ToolPart, TextPart, CompactionPart, etc. |

---

## 9. Comparison to Dexto's Current Plan

### Strengths of OpenCode's Approach

1. **Simplicity:** Token budget check is literally `length / 4`
2. **Immediate Persistence:** No batching - every update goes to storage immediately
3. **Composable Cancellation:** `using` statement is clean and scoped
4. **Message-First Design:** All outputs are parts of messages, preserving history
5. **Async Summaries:** Title generation doesn't block loop progression
6. **Clear State Transitions:** Tool parts track pending → running → completed/error
7. **Pruning vs Deletion:** Old tool outputs marked "compacted" rather than erased

### Potential Gaps in OpenCode

1. **No Explicit Message Ordering Logic:** Relies on streaming SDK maintaining order
2. **Limited Context Analysis:** No semantic pruning, only tool output truncation
3. **Summary Creation:** Full message each time, not incremental
4. **No Multi-Provider Optimization:** Single token counting formula for all providers
5. **Tool Execution Timing:** All tools run inside main loop - could block if tool is slow
6. **No Hierarchical Context:** Single flat message list, no parent/child relationships for sub-messages

### Recommendations for Dexto

1. **Adopt Part-Based Updates:** Each change gets an immediate Session.updatePart() call
2. **Use `using` for Cleanup:** Migrate to TypeScript 5.2+ and use defer pattern
3. **Keep Token Estimation Simple:** Start with `length/4`, enhance only if needed
4. **Implement Overflow-Triggered Compaction:** Check after each step
5. **Preserve Full History:** Mark old content as "archived" rather than deleting
6. **Add Multi-Provider Token Models:** Hook in real token counting APIs when available
7. **Stream-Aware Message Building:** Ensure assistant messages come before tool results

---

## 10. Integration Recommendations for Dexto

### Session Management
- Adopt OpenCode's loop structure but consider making it explicit in Dexto's context layer
- Use the callback queue pattern for concurrent requests to same session

### Compression
- Implement both auto-trigger (based on overflow) and manual trigger (via /compact command)
- Store summaries as full messages to maintain conversational continuity
- Implement pruning similar to OpenCode's approach

### Tool Integration  
- Tools should have metadata callbacks for progress updates
- Tool execution happens inside stream processor, not separately
- Track tool calls in a map to ensure proper ordering

### Persistence
- Make Session.updatePart() the fundamental unit, not messages
- Each streaming delta gets an immediate update
- Use `delta` field for UI streaming optimization

### Cancellation
- Implement defer() pattern for cleanup
- Pass abort signal through all async chains
- Use AbortController for coordinated cancellation

---

## 11. Example: How a Prompt Request Flows Through OpenCode

```
1. User calls: SessionPrompt.prompt({ sessionID, parts: [...] })
2. Creates user message with Session.updateMessage()
3. For each part: Session.updatePart()
4. Calls: loop(sessionID)

5. Loop Start:
   a. Gets abort signal from AbortController
   b. Creates defer cleanup
   c. While loop begins

6. Each Iteration:
   a. Loads messages: MessageV2.stream(sessionID)
   b. Filters out compacted messages
   c. Finds last user/assistant for state

7. Checks Three Paths:
   a. Pending subtask? → Execute TaskTool, continue
   b. Pending compaction? → Call LLM for summary, continue
   c. Context overflow? → Create compaction task, continue
   d. Normal case? → Proceed to streamText()

8. StreamText Processing:
   a. All tools resolved via resolveTools()
   b. System prompt built via resolveSystemPrompt()
   c. Messages formatted via MessageV2.toModelMessage()
   d. Stream handlers process events:
      - text-delta → Session.updatePart({delta: ...})
      - tool-call → Session.updatePart({state: running})
      - tool-result → Session.updatePart({state: completed})

9. After Each Step:
   a. Updates message with token counts
   b. Checks for context overflow
   c. If overflow: creates compaction task, loop continues
   d. If finished: checks exit condition
   e. If not finished: loop continues for tool results

10. On Cancellation:
    a. cancel(sessionID) called
    b. AbortController.abort() signals all streams
    c. defer cleanup runs → cancel() function
    d. SessionStatus set to idle
    e. Queued callbacks rejected

11. On Completion:
    a. Exit loop when: assistant.finish != "tool-calls" AND assistant.id > user.id
    b. Call prune({sessionID}) to mark old tool outputs
    c. Return final assistant message
```

---

## 12. Key Insights for Dexto Implementation

### Mental Models

1. **Messages are containers, Parts are content:** A message is a single user or assistant turn. Parts are the individual components (text, tools, reasoning). This is more granular than Dexto's current model.

2. **Streaming is primary:** The entire architecture assumes streaming is happening. Each piece of the stream becomes a separate part that gets persisted immediately.

3. **Loop reacts, doesn't predict:** The loop just processes what's there. If context overflows, it triggers compaction as a side effect. If there's a pending task, it processes it. Very reactive, not planful.

4. **Persistence is implicit:** Every operation is immediately written. No batching, no transaction window. Makes debugging easier but requires careful schema design.

5. **Token counting is external:** The session doesn't know about real tokens. It uses estimates. Real token counts come from the model after each step.

### Testing Strategy

```typescript
// Test 1: Token estimation
expect(Token.estimate("hello world")).toBe(3)  // 11 chars / 4 ≈ 3

// Test 2: Overflow detection
const overflowed = SessionCompaction.isOverflow({
  tokens: { input: 100000, output: 10000, cache: { read: 5000, write: 0 } },
  model: { limit: { context: 100000, output: 5000 } }  // context < tokens
})
expect(overflowed).toBe(true)

// Test 3: Loop with cancel
const sessionID = "test-session"
const promise = SessionPrompt.loop(sessionID)
await new Promise(r => setTimeout(r, 100))
SessionPrompt.cancel(sessionID)
await expect(promise).rejects.toThrow()

// Test 4: Message ordering
// Create stream with text, tool-call, tool-result
// Verify parts are stored in that order
```

---

## 13. Files Structure Reference

```
opencode/packages/opencode/src/
├── session/
│   ├── prompt.ts           (2000+ lines, main loop)
│   ├── processor.ts        (380 lines, stream handling)
│   ├── compaction.ts       (260 lines, compression)
│   ├── message-v2.ts       (500+ lines, schema)
│   ├── summary.ts          (150+ lines, title generation)
│   ├── retry.ts            (error handling)
│   ├── status.ts           (session status tracking)
│   ├── todo.ts             (task tracking)
│   └── index.ts            (Session namespace)
├── acp/                    (Agent Client Protocol)
│   ├── agent.ts            (730 lines, ACP protocol impl)
│   ├── session.ts          (70 lines, session manager)
│   ├── types.ts            (20 lines, types)
│   └── README.md
├── tool/
│   ├── registry.ts         (tool registry)
│   ├── bash.ts             (bash tool)
│   ├── read.ts             (file reading)
│   ├── ls.ts               (listing)
│   └── ...
├── util/
│   ├── defer.ts            (8 lines, cleanup pattern)
│   ├── token.ts            (8 lines, token estimation)
│   ├── log.ts              (logging)
│   ├── wildcard.ts         (pattern matching)
│   └── ...
├── provider/               (LLM providers)
├── permission/             (permission system)
└── storage/                (persistence layer)
```

---

## Conclusion

OpenCode's context management is elegant in its simplicity: a tight agentic loop with immediate persistence, simple token estimation, and reactive compression. The key innovation is treating everything as immutable parts within messages, with immediate database writes creating a detailed execution trace.

For Dexto, the most valuable takeaways are:
1. **Part-based persistence** with immediate updates
2. **Reactive overflow handling** via auto-compaction
3. **Clean cancellation** via defer pattern
4. **Simple token estimation** as starting point
5. **Detailed message history** for debugging and audit trails

The architecture is production-tested and handles real-world scenarios like tool timeouts, LLM errors, and user cancellations gracefully.
