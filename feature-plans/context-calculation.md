# Context Window Calculation Analysis

## Problem Statement

Our `/context` overlay shows inconsistent numbers:
- **Total shown**: 122.4k tokens (from API's actual count)
- **Breakdown sum**: ~73k tokens (our length/4 estimates)
- **Free space**: Calculated from breakdown, not actual total

This leads to confusing UX where numbers don't add up.

Additionally, our compaction decision uses a different calculation than `/context`, leading to inconsistency.

---

## Critical Finding #1: Reasoning Tokens Not Sent Back to LLM

### Current State (Dexto)

**We have the type but DON'T actually store reasoning:**
```typescript
// AssistantMessage in context/types.ts
interface AssistantMessage {
    reasoning?: string;  // Field EXISTS but is never populated!
    tokenUsage?: TokenUsage;
    // ...
}
```

**Two separate bugs:**

1. **`stream-processor.ts` never persists reasoning text:**
   ```typescript
   // Line 24: Reasoning IS accumulated during streaming
   private reasoningText: string = '';

   // Lines 97-108: Accumulated from reasoning-delta events
   case 'reasoning-delta':
       this.reasoningText += event.text;  // ✓ Collected

   // BUT lines 314-320: Only tokenUsage is persisted!
   await this.contextManager.updateAssistantMessage(
       this.assistantMessageId,
       { tokenUsage: usage }  // ✗ No reasoning field!
   );
   ```

2. **`formatAssistantMessage()` in `vercel.ts` ignores `msg.reasoning`:**
   - Only extracts `msg.content` (text parts) and `msg.toolCalls`
   - Even if reasoning WAS stored, it wouldn't be sent back

**Result:** Reasoning is collected → emitted to events → but never persisted or round-tripped.

### How OpenCode Handles It (Correctly)

```typescript
// In toModelMessage() - opencode/src/session/message-v2.ts
if (part.type === "reasoning") {
    assistantMessage.parts.push({
        type: "reasoning",
        text: part.text,
        providerMetadata: part.metadata,  // Critical for round-tripping!
    })
}
```

OpenCode:
1. Stores reasoning as `ReasoningPart` in message parts
2. Includes `providerMetadata` (contains thought signatures for Gemini, etc.)
3. Sends reasoning back in `toModelMessage()` conversion
4. Tracks `reasoning` tokens separately in token usage

### How Gemini-CLI Handles It (Different Approach)

```typescript
// Uses thought: true flag on parts from model
{ text: 'Hmm', thought: true }

// BUT they explicitly FILTER OUT thoughts before storing in history!
// geminiChat.ts line 815:
modelResponseParts.push(
  ...content.parts.filter((part) => !part.thought),  // Filter OUT thoughts
);

// Token tracking still captures thoughtsTokenCount from API response
// chatRecordingService.ts line 278:
tokens.thoughts = respUsageMetadata.thoughtsTokenCount ?? 0;
```

**Key difference:** Gemini-CLI tracks thought tokens for display/cost but does NOT round-trip them.
This works because Google's API doesn't require thought history for context continuity.

### Why We Follow OpenCode's Approach

1. **We use Vercel AI SDK** like OpenCode, not Google's native SDK
2. **Provider-agnostic**: OpenCode's approach works across all providers
3. **No provider-specific logic**: We shouldn't special-case Google's behavior
4. **Context continuity**: Some providers (especially via AI SDK) may need reasoning for proper state

### Impact of Current Bugs

1. **Context continuity broken**: Reasoning traces lost between turns
2. **Token counting incorrect**: Reasoning tokens used but not tracked in context
3. **Provider metadata lost**: Cannot round-trip provider-specific metadata (e.g., OpenAI item IDs)

---

## Critical Finding #2: Token Usage Storage

### What We Track

**Session Level** (`session-manager.ts`):
```typescript
sessionData.tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
};
```

**Message Level** (`AssistantMessage`):
```typescript
interface AssistantMessage {
    tokenUsage?: TokenUsage;  // Available but...
}
```

### Current Flow

1. `stream-processor.ts` creates assistant message with empty metadata:
   ```typescript
   await this.contextManager.addAssistantMessage('', [], {});
   ```

2. After streaming completes, we DO update with token usage:
   ```typescript
   await this.contextManager.updateAssistantMessage(
       this.assistantMessageId,
       { tokenUsage: usage }
   );
   ```

**So we HAVE the data on each message**, we just don't use it for context calculation!

---

## Critical Finding #3: Estimate vs Actual Mismatch

### The Problem

```
API actual inputTokens: 122.4k
Our length/4 estimate:   73.0k
Difference:              49.4k (67% underestimate!)
```

### Why So Different?

1. **Tokenizers don't split evenly by characters**
   - Code tokenizes differently than prose
   - JSON schemas are verbose when tokenized
   - Special characters, whitespace handling varies

2. **We're comparing different things**
   - `actualTokens` = from last LLM call (includes everything sent)
   - `breakdown estimate` = calculated now on current history

3. **Context has grown since last call**
   - Last call's `inputTokens` doesn't include the response that followed
   - New user messages added since

---

## How Other Tools Handle This

### Claude Code (Anthropic)

**Uses `/v1/messages/count_tokens` API for exact counts!**

```javascript
// From cli.js (minified)
countTokens(A,Q) {
  return this._client.post("/v1/messages/count_tokens", { body: A, ...Q })
}
```

**Categories tracked:**
- System prompt
- System tools
- Memory files
- Skills
- MCP tools (with deferred loading)
- Agents
- Messages (with sub-breakdown)
- Free space
- Autocompact buffer

**Free space calculation:**
```javascript
// YA = sum of all category tokens (excluding deferred)
let YA = k.reduce((CA, _A) => CA + (_A.isDeferred ? 0 : _A.tokens), 0)

// WA = buffer (autocompact or compact)
let WA = autocompactEnabled ? (maxTokens - contextUsed) : 500;

// Free space
let wA = Math.max(0, maxTokens - YA - WA)
```

### gemini-cli

**Hybrid approach:**

```typescript
// Sync estimation (fast)
estimateTokenCountSync(parts): number {
  // ASCII: ~4 chars per token (0.25 tokens/char)
  // Non-ASCII/CJK: ~1-2 chars per token (1.3 tokens/char)
}

// API counting (when needed)
if (hasMedia) {
  use Gemini countTokens API
} else {
  use sync estimation
}
```

**Token tracking from API response:**
```typescript
{
  input: promptTokenCount,
  output: candidatesTokenCount,
  cached: cachedContentTokenCount,
  thoughts: thoughtsTokenCount,      // Reasoning!
  tool: toolUsePromptTokenCount,
  total: totalTokenCount
}
```

### opencode

**Simple estimation + detailed tracking:**

```typescript
Token.estimate(input: string): number {
  return Math.round(input.length / 4)
}

// But tracks actuals per message:
StepFinishPart {
  tokens: {
    input: number,
    output: number,
    reasoning: number,
    cache: { read: number, write: number }
  }
}
```

---

## Current Architecture Issues

### 1. Reasoning Pipeline (BROKEN - Two Bugs)

**Current (broken):**
```
LLM Response → reasoning-delta events received
                          ↓
stream-processor.ts → accumulates reasoningText ✓
                          ↓
updateAssistantMessage() → ONLY saves tokenUsage, NOT reasoning ✗
                          ↓
AssistantMessage.reasoning = undefined (never set!)
                          ↓
formatAssistantMessage() → has nothing to format anyway
                          ↓
Reasoning NOT sent back to LLM ❌
```

**Should be (following OpenCode):**
```
LLM Response → reasoning-delta events received (with providerMetadata)
                          ↓
stream-processor.ts → accumulates reasoningText AND reasoningMetadata
                          ↓
updateAssistantMessage() → saves reasoning + reasoningMetadata + tokenUsage
                          ↓
AssistantMessage.reasoning = "thinking..." ✓
AssistantMessage.reasoningMetadata = { openai: { itemId: "..." } } ✓
                          ↓
formatAssistantMessage() → includes reasoning part with providerMetadata
                          ↓
Reasoning sent back to LLM ✓
```

### 2. Token Calculation (/context)

**Current:**
```typescript
// Uses length/4 estimate for everything
systemPromptTokens = estimateStringTokens(systemPrompt);  // length/4
messagesTokens = estimateMessagesTokens(preparedHistory); // length/4
toolsTokens = estimateToolTokens(tools);                  // length/4

total = systemPromptTokens + messagesTokens + toolsTokens;
freeSpace = maxTokens - total - outputBuffer;
```

**Problem:** Total doesn't match API's actual count.

### 3. Compaction Decision

**Current (`turn-executor.ts`):**
```typescript
const estimatedTokens = estimateMessagesTokens(prepared.preparedHistory);
if (estimatedTokens > compactionThreshold) {
  // Compact!
}
```

**Problem:** Uses different calculation than `/context`, and both are wrong!

---

## Proposed Solution

### Principle: Single Source of Truth

1. **Use actual token counts from API as ground truth**
2. **Track tokens per message for accurate history calculation**
3. **Estimate only what we cannot measure**
4. **Same formula for `/context` AND compaction decisions**

### Token Sources

| Component | Source | Notes |
|-----------|--------|-------|
| Total context | `lastMessage.tokenUsage.inputTokens + lastMessage.tokenUsage.outputTokens + newMessagesEstimate` | API actuals + estimate for new |
| System prompt | Estimate (length/4) | Changes rarely, no API source |
| Tools | Estimate (length/4) | Changes with MCP servers |
| Messages | Back-calculated: `Total - SystemPrompt - Tools` | Makes math work |
| Reasoning | `sum(message.tokenUsage.reasoningTokens)` | Track separately, included in context |
| Free space | `maxTokens - Total - outputBuffer` | Use actual total |

### The Formula

```typescript
interface ContextCalculation {
  // Step 1: Get actual from last LLM interaction
  const lastAssistant = getLastAssistantMessageWithTokenUsage();
  const lastInputTokens = lastAssistant?.tokenUsage?.inputTokens ?? 0;
  const lastOutputTokens = lastAssistant?.tokenUsage?.outputTokens ?? 0;
  
  // Step 2: Estimate new content since last LLM call
  const newMessages = getMessagesSinceLastLLMCall();
  const newMessagesEstimate = estimateTokens(newMessages);  // length/4
  
  // Step 3: Calculate current context total
  const currentContextTotal = lastInputTokens + lastOutputTokens + newMessagesEstimate;
  
  // Step 4: Breakdown (estimates for fixed parts, back-calculate messages)
  const systemPromptEstimate = estimateTokens(systemPrompt);
  const toolsEstimate = estimateTokens(tools);
  const reasoningTokens = sumReasoningTokensFromHistory();  // From stored tokenUsage
  const messagesDisplay = currentContextTotal - systemPromptEstimate - toolsEstimate;
  
  // Step 5: Free space
  const freeSpace = maxContextTokens - currentContextTotal - outputBuffer;
  
  // Step 6: Calibration logging
  const messagesEstimate = estimateTokens(allMessages);
  const calibrationRatio = messagesDisplay / messagesEstimate;
  logger.info(`Context calibration: actual=${messagesDisplay}, estimate=${messagesEstimate}, ratio=${calibrationRatio.toFixed(2)}`);
  
  return {
    total: currentContextTotal,
    breakdown: {
      systemPrompt: systemPromptEstimate,
      tools: toolsEstimate,
      messages: messagesDisplay,
      reasoning: reasoningTokens,  // For display, already included in total
    },
    freeSpace,
    outputBuffer,
  };
}
```

### Edge Cases

1. **No LLM call yet (new session)**
   - Fall back to pure estimation
   - All numbers are estimates with "(estimated)" label
   
2. **messagesDisplay comes out negative**
   - Our estimates for system/tools are too high
   - Cap at 0, log warning
   - Indicates estimation needs calibration

3. **After compaction**
   - Token counts reset with new session
   - `compactionCount` tracks how many times compacted

4. **Reasoning tokens**
   - Must be sent back to LLM (fix formatter)
   - Include in context calculation
   - Track separately for display

---

## Implementation Plan

### Phase 1: Fix Reasoning Storage (HIGH PRIORITY - Bug #1)

**The root cause:** `stream-processor.ts` collects reasoning but never persists it.

**Files to modify:**
- `packages/core/src/llm/executor/stream-processor.ts`
- `packages/core/src/context/types.ts`

**Changes:**

1. Add `reasoningMetadata` field to `AssistantMessage` type:
   ```typescript
   // In context/types.ts
   interface AssistantMessage {
     reasoning?: string;
     reasoningMetadata?: Record<string, unknown>;  // NEW - for provider round-tripping
     // ...
   }
   ```

2. Capture `providerMetadata` from reasoning-delta events:
   ```typescript
   // In stream-processor.ts, add field:
   private reasoningMetadata: Record<string, unknown> | undefined;

   // In reasoning-delta case:
   case 'reasoning-delta':
       this.reasoningText += event.text;
       // Capture provider metadata for round-tripping (OpenAI itemId, etc.)
       if (event.providerMetadata) {
           this.reasoningMetadata = event.providerMetadata;
       }
       // ... emit events
   ```

3. **Fix the bug** - persist reasoning in `updateAssistantMessage()`:
   ```typescript
   // In stream-processor.ts, 'finish' case (around line 315):
   if (this.assistantMessageId) {
       await this.contextManager.updateAssistantMessage(
           this.assistantMessageId,
           {
               tokenUsage: usage,
               reasoning: this.reasoningText || undefined,           // ADD THIS
               reasoningMetadata: this.reasoningMetadata,            // ADD THIS
           }
       );
   }
   ```

### Phase 2: Fix Reasoning Round-Trip (Bug #2)

**Files to modify:**
- `packages/core/src/llm/formatters/vercel.ts`

**Changes:**

1. Update `formatAssistantMessage()` to include reasoning:
   ```typescript
   // In formatAssistantMessage(), before returning:
   if (msg.reasoning) {
       contentParts.push({
           type: 'reasoning',
           text: msg.reasoning,
           providerMetadata: msg.reasoningMetadata,
       });
   }
   ```

**Note:** Need to verify Vercel AI SDK's `AssistantContent` type supports reasoning parts.
Check `ai` package types - if not supported, may need to use provider-specific handling.

### Phase 3: Unified Context Calculation

**Files to modify:**
- `packages/core/src/context/manager.ts` - `getContextTokenEstimate()`
- `packages/core/src/llm/executor/turn-executor.ts` - compaction check
- `packages/cli/src/cli/ink-cli/components/overlays/ContextStatsOverlay.tsx`

**Changes:**

1. Create shared `calculateContextUsage()` function:
   ```typescript
   // New file: packages/core/src/context/context-calculator.ts
   export async function calculateContextUsage(
     contextManager: ContextManager,
     tools: ToolDefinitions,
     maxContextTokens: number,
     outputBuffer: number
   ): Promise<ContextUsage> {
     // Implement the formula above
   }
   ```

2. Use in `/context`:
   ```typescript
   // In DextoAgent.getContextStats()
   const usage = await calculateContextUsage(...);
   return usage;
   ```

3. Use in compaction decision:
   ```typescript
   // In turn-executor.ts
   const usage = await calculateContextUsage(...);
   if (usage.total > compactionThreshold) {
     // Compact!
   }
   ```

### Phase 4: Message-Level Token Tracking

**Already implemented!** We just need to use it:

```typescript
// In calculateContextUsage(), sum from messages:
const history = await contextManager.getHistory();
let totalInputFromMessages = 0;
let totalOutputFromMessages = 0;
let totalReasoningFromMessages = 0;

for (const msg of history) {
  if (msg.role === 'assistant' && msg.tokenUsage) {
    totalOutputFromMessages += msg.tokenUsage.outputTokens ?? 0;
    totalReasoningFromMessages += msg.tokenUsage.reasoningTokens ?? 0;
  }
}
```

### Phase 5: Calibration & Logging

1. Log estimate vs actual on every LLM call (already done, level=info)
2. Track calibration ratio over time
3. Consider adaptive estimation based on observed ratios

### Phase 6: Future - API Token Counting

**For Anthropic:**
```typescript
// New method in Anthropic service
async countTokens(messages: Message[], tools: Tool[]): Promise<{
  input_tokens: number;
}>
```

**For other providers:**
- tiktoken for OpenAI
- Gemini countTokens API
- Fallback to estimation

---

## Data Flow Diagram

### Current State (BROKEN)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LLM Response Stream                          │
├─────────────────────────────────────────────────────────────────────┤
│  reasoning-delta events → reasoningText accumulated ✓               │
│  text-delta events → content accumulated ✓                          │
│  finish event → usage: { inputTokens, outputTokens, ... }           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              stream-processor.ts updateAssistantMessage()           │
├─────────────────────────────────────────────────────────────────────┤
│  await this.contextManager.updateAssistantMessage(                  │
│      this.assistantMessageId,                                       │
│      { tokenUsage: usage }     ← ONLY tokenUsage saved!             │
│  );                            ← reasoning NOT included! ✗          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AssistantMessage Stored                          │
├─────────────────────────────────────────────────────────────────────┤
│  {                                                                  │
│    role: 'assistant',                                               │
│    content: [...],             ← ✓ Stored                           │
│    reasoning: undefined,       ← ✗ NEVER SET!                       │
│    tokenUsage: {...}           ← ✓ Stored                           │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘

### Target State (FIXED)

┌─────────────────────────────────────────────────────────────────────┐
│                         LLM Response Stream                          │
├─────────────────────────────────────────────────────────────────────┤
│  reasoning-delta events → reasoningText + providerMetadata ✓        │
│  text-delta events → content accumulated ✓                          │
│  finish event → usage: { inputTokens, outputTokens, ... }           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              stream-processor.ts updateAssistantMessage()           │
├─────────────────────────────────────────────────────────────────────┤
│  await this.contextManager.updateAssistantMessage(                  │
│      this.assistantMessageId,                                       │
│      {                                                              │
│          tokenUsage: usage,                                         │
│          reasoning: this.reasoningText,           ← NEW             │
│          reasoningMetadata: this.reasoningMetadata ← NEW            │
│      }                                                              │
│  );                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AssistantMessage Stored                          │
├─────────────────────────────────────────────────────────────────────┤
│  {                                                                  │
│    role: 'assistant',                                               │
│    content: [...],                                                  │
│    reasoning: 'Let me think...',    ← ✓ Now stored                  │
│    reasoningMetadata: { openai: { itemId: '...' } }, ← ✓ For round-trip
│    tokenUsage: { inputTokens, outputTokens, reasoningTokens }       │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next LLM Call (Formatter)                        │
├─────────────────────────────────────────────────────────────────────┤
│  formatAssistantMessage() includes:                                 │
│    - content (text parts)              ✓ Already done               │
│    - toolCalls                         ✓ Already done               │
│    - reasoning + providerMetadata      ✓ NEW - enables round-trip   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    /context Calculation                             │
├─────────────────────────────────────────────────────────────────────┤
│  currentTotal = lastInput + lastOutput + newMessagesEstimate        │
│                                                                     │
│  Breakdown:                                                         │
│    systemPrompt = estimate (length/4)                               │
│    tools = estimate (length/4)                                      │
│    messages = currentTotal - systemPrompt - tools (back-calc)       │
│    reasoning = sum(msg.tokenUsage.reasoningTokens) (for display)    │
│                                                                     │
│  freeSpace = maxTokens - currentTotal - outputBuffer                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Compaction Decision                              │
├─────────────────────────────────────────────────────────────────────┤
│  SAME FORMULA as /context!                                          │
│                                                                     │
│  if (currentTotal > compactionThreshold) {                          │
│    triggerCompaction();                                             │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests

1. **Reasoning storage test (Phase 1)**
   - Mock LLM stream with reasoning-delta events
   - Verify `stream-processor.ts` calls `updateAssistantMessage()` with reasoning
   - Verify `reasoningMetadata` is captured from `providerMetadata`

2. **Reasoning round-trip test (Phase 2)**
   - Create `AssistantMessage` with `reasoning` and `reasoningMetadata`
   - Call `formatAssistantMessage()`
   - Verify output contains reasoning part with `providerMetadata`

3. **Token calculation test (Phase 3)**
   - Mock message with known tokenUsage
   - Verify calculation matches expected

4. **Edge case tests**
   - New session (no actuals) - falls back to estimation
   - Negative messagesDisplay (capped at 0)
   - Post-compaction state
   - Empty reasoning (should not create empty reasoning part)

### Integration Tests

1. **Full reasoning flow test**
   - Enable extended thinking on Claude
   - Send message that triggers reasoning
   - Verify reasoning persisted to message
   - Send follow-up message
   - Verify reasoning sent back to LLM (check formatted messages)

2. **Token tracking test**
   - Send message
   - Verify tokenUsage stored on message
   - Open /context
   - Verify numbers use actual from last call

3. **Compaction alignment test**
   - Fill context near threshold
   - Verify /context and compaction trigger at same point

---

## Success Criteria

1. **Numbers add up**: Total = SystemPrompt + Tools + Messages
2. **Consistency**: /context and compaction use same calculation
3. **Reasoning works**: Traces sent back to LLM correctly
4. **Calibration visible**: Logs show estimate vs actual ratio
5. **Provider compatibility**: Works with Anthropic, OpenAI, Google, etc.

---

## Appendix: Verification Against Other Implementations

*This plan was verified against actual implementations on 2025-01-20.*

### OpenCode Verification (~/Projects/external/opencode)

| Claim | Verified | Evidence |
|-------|----------|----------|
| Stores reasoning as `ReasoningPart` | ✅ | `message-v2.ts` lines 78-89 |
| Includes `providerMetadata` for round-tripping | ✅ | `message-v2.ts` lines 554-560 |
| `toModelMessage()` sends reasoning back | ✅ | `message-v2.ts` lines 435-569 |
| Tracks reasoning tokens separately | ✅ | `session/index.ts` line 432, schemas throughout |
| Handles provider-specific metadata | ✅ | `openai-responses-language-model.ts` lines 520-538 |

**OpenCode approach:** Full round-trip of reasoning with provider metadata. This is our reference implementation.

### Gemini-CLI Verification (~/Projects/external/gemini-cli)

| Claim in Original Plan | Actual Behavior | Status |
|------------------------|-----------------|--------|
| "Parts with thought: true included when sending history back" | **WRONG** - They filter OUT thoughts at line 815 | ❌ Corrected |
| Uses `thought: true` flag | ✅ Correct | ✅ |
| Tracks `thoughtsTokenCount` | ✅ Correct - `chatRecordingService.ts` line 278 | ✅ |

**Gemini-CLI approach:** Track thought tokens for cost/display but do NOT round-trip them.
This is a simpler approach but requires Google-specific handling.

### Why We Follow OpenCode

1. **Same SDK**: Both use Vercel AI SDK
2. **Provider-agnostic**: Works across all providers without special-casing
3. **Future-proof**: Preserves metadata for providers that need it
4. **Simpler code**: No provider-specific filtering logic

### Dexto Implementation Verification

| Component | Current State | Bug |
|-----------|---------------|-----|
| `stream-processor.ts` | Accumulates `reasoningText` but doesn't persist | **Bug #1** |
| `vercel.ts` formatter | Ignores `msg.reasoning` | **Bug #2** (blocked by #1) |
| `AssistantMessage` type | Has `reasoning?: string` field | ✅ Ready |
| Per-message `tokenUsage` | Stored via `updateAssistantMessage()` | ✅ Working |
| `lastActualInputTokens` | Set after each LLM call | ✅ Working |
| Compaction calculation | Uses `estimateMessagesTokens()` only | Different from /context |
| `/context` calculation | Uses full estimation (system + tools + messages) | Different from compaction |
