# Gemini-CLI Context Management Research Report

**Research Date**: November 27, 2025  
**Scope**: Deep dive into gemini-cli's execution loop, context compression, and persistence patterns  
**Project Repository**: /Users/karaj/Projects/gemini-cli

## Executive Summary

The gemini-cli project demonstrates a mature implementation of agent execution with sophisticated context management. Key innovations include:

1. **Custom Turn Execution Loop** with hybrid compression triggering
2. **Adaptive Token Counting** using heuristics with API fallback
3. **File-based Persistence** with queued metadata pattern for message ordering
4. **Parallel Tool Execution** using `Promise.all()`
5. **Graceful Cancellation** with timeout grace periods and recovery turns
6. **Curated History Pattern** that filters invalid content before requests

---

## 1. Custom Turn Execution Loop

### Location
- **Main File**: `/Users/karaj/Projects/gemini-cli/packages/core/src/agents/executor.ts`
- **Turn Handler**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/turn.ts`
- **Lines**: executor.ts: 182-239, 366-556

### Architecture

The `AgentExecutor` class implements a state machine-based turn execution:

```typescript
// From executor.ts, lines 182-239
private async executeTurn(
  chat: GeminiChat,
  currentMessage: Content,
  tools: FunctionDeclaration[],
  turnCounter: number,
  combinedSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<AgentTurnResult> {
  const promptId = `${this.agentId}#${turnCounter}`;
  
  // Step 1: Attempt compression before model call
  await this.tryCompressChat(chat, promptId);
  
  // Step 2: Call model with abort signal
  const { functionCalls } = await promptIdContext.run(promptId, async () =>
    this.callModel(chat, currentMessage, tools, combinedSignal, promptId),
  );
  
  // Step 3: Check abort signals
  if (combinedSignal.aborted) {
    const terminateReason = timeoutSignal.aborted
      ? AgentTerminateMode.TIMEOUT
      : AgentTerminateMode.ABORTED;
    return { status: 'stop', terminateReason, finalResult: null };
  }
  
  // Step 4: Process tool calls and determine continuation
  const { nextMessage, submittedOutput, taskCompleted } =
    await this.processFunctionCalls(functionCalls, combinedSignal, promptId);
  
  if (taskCompleted) {
    return { status: 'stop', terminateReason: AgentTerminateMode.GOAL, finalResult };
  }
  
  return { status: 'continue', nextMessage };
}
```

### Turn Result Types
```typescript
// From executor.ts, lines 64-73
type AgentTurnResult =
  | { status: 'continue'; nextMessage: Content }
  | {
      status: 'stop';
      terminateReason: AgentTerminateMode;
      finalResult: string | null;
    };
```

### Main Execution Loop
```typescript
// From executor.ts, lines 397-434
while (true) {
  // 1. Check termination conditions (max turns, time limits)
  const reason = this.checkTermination(startTime, turnCounter);
  if (reason) {
    terminateReason = reason;
    break;
  }
  
  // 2. Check for timeout or external abort
  if (combinedSignal.aborted) {
    terminateReason = timeoutController.signal.aborted
      ? AgentTerminateMode.TIMEOUT
      : AgentTerminateMode.ABORTED;
    break;
  }
  
  // 3. Execute turn
  const turnResult = await this.executeTurn(
    chat,
    currentMessage,
    tools,
    turnCounter++,
    combinedSignal,
    timeoutController.signal,
  );
  
  // 4. Handle result
  if (turnResult.status === 'stop') {
    terminateReason = turnResult.terminateReason;
    if (turnResult.finalResult) {
      finalResult = turnResult.finalResult;
    }
    break;
  }
  
  currentMessage = turnResult.nextMessage;
}
```

### Key Insights

1. **Turnstile Pattern**: Each turn is a complete cycle: compress → call model → check signals → process tools → decide continuation
2. **Unified Signal Handling**: Combines external abort signal with internal timeout controller using `AbortSignal.any()`
3. **Prompt ID Tracking**: Each turn has a unique `promptId` for tracing (e.g., "agent-name-12345#0")
4. **Result Immutability**: Turn results are discriminated unions, making state transitions explicit

---

## 2. Compression Strategy

### Location
- **Compression Service**: `/Users/karaj/Projects/gemini-cli/packages/core/src/services/chatCompressionService.ts`
- **Token Limits**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/tokenLimits.ts`
- **Prompts**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/prompts.ts` (lines 392-450)

### Compression Thresholds

```typescript
// From chatCompressionService.ts, lines 29-35
export const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;  // 50% of limit
export const COMPRESSION_PRESERVE_THRESHOLD = 0.3;       // Keep last 30%
```

**Strategy**: When chat history exceeds 50% of model's token limit:
1. Find split point at the 70th percentile of history (compress 70%, preserve 30%)
2. Compress pre-split-point messages using LLM
3. Replace with dense summary + preserved recent context
4. Validate: if compression inflates tokens, discard and disable for this session

### Compression Flow

```typescript
// From chatCompressionService.ts, lines 101-233
async compress(
  chat: GeminiChat,
  promptId: string,
  force: boolean,
  model: string,
  config: Config,
  hasFailedCompressionAttempt: boolean,
): Promise<{ newHistory: Content[] | null; info: ChatCompressionInfo }> {
  const curatedHistory = chat.getHistory(true);
  
  // 1. Bail if history empty or compression failed before
  if (
    curatedHistory.length === 0 ||
    (hasFailedCompressionAttempt && !force)
  ) {
    return {
      newHistory: null,
      info: { originalTokenCount: 0, newTokenCount: 0, compressionStatus: CompressionStatus.NOOP },
    };
  }
  
  const originalTokenCount = chat.getLastPromptTokenCount();
  
  // 2. Check threshold
  if (!force) {
    const threshold =
      (await config.getCompressionThreshold()) ??
      DEFAULT_COMPRESSION_TOKEN_THRESHOLD;
    if (originalTokenCount < threshold * tokenLimit(model)) {
      return {
        newHistory: null,
        info: { originalTokenCount, newTokenCount: originalTokenCount, compressionStatus: CompressionStatus.NOOP },
      };
    }
  }
  
  // 3. Find split point (70% to compress, 30% to keep)
  const splitPoint = findCompressSplitPoint(
    curatedHistory,
    1 - COMPRESSION_PRESERVE_THRESHOLD,
  );
  
  const historyToCompress = curatedHistory.slice(0, splitPoint);
  const historyToKeep = curatedHistory.slice(splitPoint);
  
  if (historyToCompress.length === 0) {
    return { newHistory: null, info: { originalTokenCount, newTokenCount: originalTokenCount, compressionStatus: CompressionStatus.NOOP } };
  }
  
  // 4. Call LLM for summary
  const summaryResponse = await config.getBaseLlmClient().generateContent({
    modelConfigKey: { model: modelStringToModelConfigAlias(model) },
    contents: [...historyToCompress, { role: 'user', parts: [{ text: 'First, reason in your scratchpad. Then, generate the <state_snapshot>.' }] }],
    systemInstruction: { text: getCompressionPrompt() },
    promptId,
    abortSignal: new AbortController().signal,
  });
  
  const summary = getResponseText(summaryResponse) ?? '';
  
  // 5. Build new history: summary + preserved messages
  const extraHistory: Content[] = [
    { role: 'user', parts: [{ text: summary }] },
    { role: 'model', parts: [{ text: 'Got it. Thanks for the additional context!' }] },
    ...historyToKeep,
  ];
  
  // 6. Validate: new token count < original token count
  const newTokenCount = await calculateRequestTokenCount(
    fullNewHistory.flatMap((c) => c.parts || []),
    config.getContentGenerator(),
    model,
  );
  
  if (newTokenCount > originalTokenCount) {
    // Compression backfired, mark as failed and don't use
    return {
      newHistory: null,
      info: { originalTokenCount, newTokenCount, compressionStatus: CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT },
    };
  }
  
  return { newHistory: extraHistory, info: { originalTokenCount, newTokenCount, compressionStatus: CompressionStatus.COMPRESSED } };
}
```

### Split Point Algorithm

```typescript
// From chatCompressionService.ts, lines 43-83
export function findCompressSplitPoint(
  contents: Content[],
  fraction: number,
): number {
  if (fraction <= 0 || fraction >= 1) {
    throw new Error('Fraction must be between 0 and 1');
  }
  
  const charCounts = contents.map((content) => JSON.stringify(content).length);
  const totalCharCount = charCounts.reduce((a, b) => a + b, 0);
  const targetCharCount = totalCharCount * fraction;
  
  let lastSplitPoint = 0;
  let cumulativeCharCount = 0;
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    // Only split at user message boundaries (not after tool responses)
    if (
      content.role === 'user' &&
      !content.parts?.some((part) => !!part.functionResponse)
    ) {
      if (cumulativeCharCount >= targetCharCount) {
        return i;
      }
      lastSplitPoint = i;
    }
    cumulativeCharCount += charCounts[i];
  }
  
  // Only compress everything if last message is model message with no pending function calls
  const lastContent = contents[contents.length - 1];
  if (
    lastContent?.role === 'model' &&
    !lastContent?.parts?.some((part) => part.functionCall)
  ) {
    return contents.length;
  }
  
  return lastSplitPoint;
}
```

### Compression Prompt Template

```xml
<!-- From prompts.ts, lines 392-450 -->
<state_snapshot>
    <overall_goal>
        <!-- A single, concise sentence describing the user's high-level objective. -->
    </overall_goal>

    <key_knowledge>
        <!-- Crucial facts, conventions, and constraints the agent must remember. -->
        <!-- Example:
         - Build Command: `npm run build`
         - Testing: Tests are run with `npm test`
         - API Endpoint: The primary API endpoint is `https://api.example.com/v2`
        -->
    </key_knowledge>

    <file_system_state>
        <!-- List files that have been created, read, modified, or deleted. -->
        <!-- Example:
         - CWD: `/home/user/project/src`
         - READ: `package.json` - Confirmed 'axios' is a dependency.
         - MODIFIED: `services/auth.ts` - Replaced 'jsonwebtoken' with 'jose'.
        -->
    </file_system_state>

    <recent_actions>
        <!-- A summary of the last few significant agent actions and their outcomes. -->
    </recent_actions>

    <current_plan>
        <!-- The agent's step-by-step plan. Mark completed steps. -->
    </current_plan>
</state_snapshot>
```

### Adaptive Compression Behavior

```typescript
// From executor.ts, lines 558-584
private async tryCompressChat(chat: GeminiChat, prompt_id: string): Promise<void> {
  const model = this.definition.modelConfig.model;
  
  const { newHistory, info } = await this.compressionService.compress(
    chat,
    prompt_id,
    false,  // Not forced
    model,
    this.runtimeContext,
    this.hasFailedCompressionAttempt,  // Track failures across session
  );
  
  if (info.compressionStatus === CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT) {
    // Mark failure and disable compression for rest of session
    this.hasFailedCompressionAttempt = true;
  } else if (info.compressionStatus === CompressionStatus.COMPRESSED) {
    if (newHistory) {
      // Update chat history in-place
      chat.setHistory(newHistory);
      this.hasFailedCompressionAttempt = false;  // Reset on success
    }
  }
}
```

### Key Insights

1. **Threshold at 50%**: Compression triggers at moderate usage, allowing buffer for model calls
2. **Preserve Last 30%**: Recent context preserved ensures fresh context not lost
3. **Safe Boundaries**: Splits only at user message boundaries to maintain conversation integrity
4. **Failure Mode**: If compression inflates tokens (due to overhead), disable for session rather than risk degradation
5. **Token Validation**: Both before (via `lastPromptTokenCount`) and after compression token counts tracked
6. **LLM-Driven Summary**: Uses model's own reasoning to understand context, not just text extraction

---

## 3. Token Counting Strategy

### Location
- **Token Calculation**: `/Users/karaj/Projects/gemini-cli/packages/core/src/utils/tokenCalculation.ts`
- **Token Limits**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/tokenLimits.ts`

### Heuristic Algorithm

```typescript
// From tokenCalculation.ts, lines 10-41
const ASCII_TOKENS_PER_CHAR = 0.25;           // ASCII: 4 chars per token
const NON_ASCII_TOKENS_PER_CHAR = 1.3;        // Non-ASCII: ~1.3 tokens per char

export function estimateTokenCountSync(parts: Part[]): number {
  let totalTokens = 0;
  for (const part of parts) {
    if (typeof part.text === 'string') {
      // Character-by-character estimation
      for (const char of part.text) {
        if (char.codePointAt(0)! <= 127) {
          // ASCII character
          totalTokens += ASCII_TOKENS_PER_CHAR;
        } else {
          // Non-ASCII (CJK, emoji, etc.)
          totalTokens += NON_ASCII_TOKENS_PER_CHAR;
        }
      }
    } else {
      // Non-text parts (function calls, responses, etc.)
      // Fall back to JSON serialization heuristic
      totalTokens += JSON.stringify(part).length / 4;
    }
  }
  return Math.floor(totalTokens);
}
```

### Hybrid Approach with API Fallback

```typescript
// From tokenCalculation.ts, lines 48-79
export async function calculateRequestTokenCount(
  request: PartListUnion,
  contentGenerator: ContentGenerator,
  model: string,
): Promise<number> {
  const parts: Part[] = Array.isArray(request)
    ? request.map((p) => (typeof p === 'string' ? { text: p } : p))
    : typeof request === 'string'
      ? [{ text: request }]
      : [request];
  
  // Check for media (images, files) which are hard to estimate
  const hasMedia = parts.some((p) => {
    const isMedia = 'inlineData' in p || 'fileData' in p;
    return isMedia;
  });
  
  if (hasMedia) {
    try {
      // Use API for accurate media token counts
      const response = await contentGenerator.countTokens({
        model,
        contents: [{ role: 'user', parts }],
      });
      return response.totalTokens ?? 0;
    } catch {
      // Graceful fallback if API unavailable
      return estimateTokenCountSync(parts);
    }
  }
  
  // For text-only requests, use fast heuristic
  return estimateTokenCountSync(parts);
}
```

### Model-Specific Limits

```typescript
// From tokenLimits.ts, lines 12-31
export function tokenLimit(model: Model): TokenCount {
  switch (model) {
    case 'gemini-1.5-pro':
      return 2_097_152;  // 2M tokens
    case 'gemini-1.5-flash':
    case 'gemini-2.5-pro-preview-05-06':
    case 'gemini-2.5-pro-preview-06-05':
    case 'gemini-2.5-pro':
    case 'gemini-2.5-flash-preview-05-20':
    case 'gemini-2.5-flash':
    case 'gemini-2.5-flash-lite':
    case 'gemini-2.0-flash':
      return 1_048_576;  // 1M tokens
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;
    default:
      return DEFAULT_TOKEN_LIMIT;  // 1M default
  }
}
```

### Key Insights

1. **Dual Strategy**: Fast heuristic for text (char-based), API fallback for media
2. **Character-Level Precision**: Handles ASCII vs. non-ASCII differently (4:1 vs 1.3:1 ratio)
3. **JSON Approximation**: Non-text structured data estimated via JSON length / 4
4. **Graceful Degradation**: API failures don't block execution, reverts to heuristic
5. **Model-Aware Limits**: Different token limits per model variant (1M - 2M range for current models)

---

## 4. Persistence Pattern: File-Based JSON with Queued Metadata

### Location
- **Chat Recording Service**: `/Users/karaj/Projects/gemini-cli/packages/core/src/services/chatRecordingService.ts`
- **Storage Paths**: `/Users/karaj/Projects/gemini-cli/packages/core/src/config/storage.ts`

### File Organization

```
~/.gemini/tmp/<project_hash>/chats/
├── session-2025-11-27T15-30-sessionid.json
├── session-2025-11-27T16-15-sessionid.json
└── ...
```

### Data Structures

```typescript
// From chatRecordingService.ts, lines 21-89
export const SESSION_FILE_PREFIX = 'session-';

export interface TokensSummary {
  input: number;        // promptTokenCount
  output: number;       // candidatesTokenCount
  cached: number;       // cachedContentTokenCount
  thoughts?: number;    // thoughtsTokenCount
  tool?: number;        // toolUsePromptTokenCount
  total: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: PartListUnion | null;
  status: Status;
  timestamp: string;
  displayName?: string;
  description?: string;
  resultDisplay?: string;
  renderOutputAsMarkdown?: boolean;
}

export type ConversationRecordExtra =
  | { type: 'user' | 'info' | 'error' | 'warning' }
  | {
      type: 'gemini';
      toolCalls?: ToolCallRecord[];
      thoughts?: Array<ThoughtSummary & { timestamp: string }>;
      tokens?: TokensSummary | null;
      model?: string;
    };

export type MessageRecord = BaseMessageRecord & ConversationRecordExtra;

export interface ConversationRecord {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: MessageRecord[];
}
```

### Queued Metadata Pattern

```typescript
// From chatRecordingService.ts, lines 110-177
export class ChatRecordingService {
  private conversationFile: string | null = null;
  private cachedLastConvData: string | null = null;
  private sessionId: string;
  private projectHash: string;
  
  // QUEUED METADATA: Accumulate metadata until message creation
  private queuedThoughts: Array<ThoughtSummary & { timestamp: string }> = [];
  private queuedTokens: TokensSummary | null = null;
  
  initialize(resumedSessionData?: ResumedSessionData): void {
    // ... file creation ...
    this.queuedThoughts = [];
    this.queuedTokens = null;
  }
  
  recordThought(thought: ThoughtSummary): void {
    // Queue thoughts as they arrive from streaming
    this.queuedThoughts.push({
      ...thought,
      timestamp: new Date().toISOString(),
    });
  }
  
  recordMessageTokens(respUsageMetadata: GenerateContentResponseUsageMetadata): void {
    // Queue token metadata
    this.queuedTokens = {
      input: respUsageMetadata.promptTokenCount ?? 0,
      output: respUsageMetadata.candidatesTokenCount ?? 0,
      cached: respUsageMetadata.cachedContentTokenCount ?? 0,
      thoughts: respUsageMetadata.thoughtsTokenCount ?? 0,
      tool: respUsageMetadata.toolUsePromptTokenCount ?? 0,
      total: respUsageMetadata.totalTokenCount ?? 0,
    };
  }
  
  recordMessage(message: {
    model: string | undefined;
    type: ConversationRecordExtra['type'];
    content: PartListUnion;
  }): void {
    this.updateConversation((conversation) => {
      const msg = this.newMessage(message.type, message.content);
      if (msg.type === 'gemini') {
        // DEQUEUE: Attach all queued metadata to message
        conversation.messages.push({
          ...msg,
          thoughts: this.queuedThoughts,      // Attach queued thoughts
          tokens: this.queuedTokens,          // Attach queued tokens
          model: message.model,
        });
        // CLEAR QUEUE after attaching
        this.queuedThoughts = [];
        this.queuedTokens = null;
      } else {
        conversation.messages.push(msg);
      }
    });
  }
}
```

### Message Ordering Guarantee

```typescript
// From chatRecordingService.ts, lines 304-372
recordToolCalls(model: string, toolCalls: ToolCallRecord[]): void {
  this.updateConversation((conversation) => {
    const lastMsg = this.getLastMessage(conversation);
    
    // Key insight: Handle tool calls that arrive before message creation
    if (
      !lastMsg ||
      lastMsg.type !== 'gemini' ||
      this.queuedThoughts.length > 0  // New thoughts = new message coming
    ) {
      // Create new message with tool calls
      const newMsg: MessageRecord = {
        ...this.newMessage('gemini' as const, ''),
        type: 'gemini' as const,
        toolCalls: enrichedToolCalls,
        thoughts: this.queuedThoughts,
        model,
      };
      // Dequeue thoughts
      if (this.queuedThoughts.length > 0) {
        newMsg.thoughts = this.queuedThoughts;
        this.queuedThoughts = [];
      }
      // Dequeue tokens
      if (this.queuedTokens) {
        newMsg.tokens = this.queuedTokens;
        this.queuedTokens = null;
      }
      conversation.messages.push(newMsg);
    } else {
      // Update existing message: merge tool calls
      if (!lastMsg.toolCalls) {
        lastMsg.toolCalls = [];
      }
      // Update existing tool calls
      lastMsg.toolCalls = lastMsg.toolCalls.map((toolCall) => {
        const incomingToolCall = toolCalls.find((tc) => tc.id === toolCall.id);
        if (incomingToolCall) {
          return { ...toolCall, ...incomingToolCall };
        }
        return toolCall;
      });
      // Add new tool calls
      for (const toolCall of enrichedToolCalls) {
        const existingToolCall = lastMsg.toolCalls.find(
          (tc) => tc.id === toolCall.id,
        );
        if (!existingToolCall) {
          lastMsg.toolCalls.push(toolCall);
        }
      }
    }
  });
}
```

### File I/O Pattern

```typescript
// From chatRecordingService.ts, lines 385-438
private readConversation(): ConversationRecord {
  try {
    this.cachedLastConvData = fs.readFileSync(this.conversationFile!, 'utf8');
    return JSON.parse(this.cachedLastConvData);
  } catch (error) {
    // Return empty placeholder if file doesn't exist yet
    return {
      sessionId: this.sessionId,
      projectHash: this.projectHash,
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messages: [],
    };
  }
}

private writeConversation(conversation: ConversationRecord): void {
  if (!this.conversationFile) return;
  // Don't write until there's at least one message
  if (conversation.messages.length === 0) return;
  
  // Only write if content actually changed (using cached comparison)
  if (this.cachedLastConvData !== JSON.stringify(conversation, null, 2)) {
    conversation.lastUpdated = new Date().toISOString();
    const newContent = JSON.stringify(conversation, null, 2);
    this.cachedLastConvData = newContent;
    fs.writeFileSync(this.conversationFile, newContent);
  }
}

private updateConversation(
  updateFn: (conversation: ConversationRecord) => void
) {
  const conversation = this.readConversation();
  updateFn(conversation);
  this.writeConversation(conversation);
}
```

### Key Insights

1. **Queued Metadata Pattern**: Thoughts and token data queued during streaming, attached when message completes
2. **Content-Free Files**: Files only written when messages exist (avoid empty files)
3. **Change Detection**: Cached JSON comparison prevents unnecessary disk writes
4. **Message Ordering**: Tool calls auto-create new message if needed (e.g., if tool calls arrive with queued thoughts)
5. **Resumable Sessions**: File includes `sessionId` and `projectHash` for reload/resume capability
6. **Timestamps**: Every message and thought stamped, last update time tracked

---

## 5. Parallel Tool Execution

### Location
- **Tool Processing**: `/Users/karaj/Projects/gemini-cli/packages/core/src/agents/executor.ts`, lines 696-914

### Implementation

```typescript
// From executor.ts, lines 696-914
private async processFunctionCalls(
  functionCalls: FunctionCall[],
  signal: AbortSignal,
  promptId: string,
): Promise<{
  nextMessage: Content;
  submittedOutput: string | null;
  taskCompleted: boolean;
}> {
  const allowedToolNames = new Set(this.toolRegistry.getAllToolNames());
  allowedToolNames.add(TASK_COMPLETE_TOOL_NAME);
  
  let submittedOutput: string | null = null;
  let taskCompleted = false;
  
  // Collect promises for async tool executions
  const toolExecutionPromises: Array<Promise<Part[] | void>> = [];
  // Synchronous responses (complete_task, blocked calls)
  const syncResponseParts: Part[] = [];
  
  for (const [index, functionCall] of functionCalls.entries()) {
    const callId = functionCall.id ?? `${promptId}-${index}`;
    const args = (functionCall.args ?? {}) as Record<string, unknown>;
    
    this.emitActivity('TOOL_CALL_START', { name: functionCall.name, args });
    
    // SYNCHRONOUS CASE 1: complete_task
    if (functionCall.name === TASK_COMPLETE_TOOL_NAME) {
      // Handle task completion synchronously
      taskCompleted = true;
      
      if (outputConfig) {
        // Validate output
        const validationResult = outputConfig.schema.safeParse(args[outputName]);
        if (!validationResult.success) {
          taskCompleted = false;
          syncResponseParts.push({
            functionResponse: {
              name: TASK_COMPLETE_TOOL_NAME,
              response: { error: `Output validation failed: ...` },
              id: callId,
            },
          });
          continue;
        }
        
        submittedOutput = this.definition.processOutput
          ? this.definition.processOutput(validationResult.data)
          : JSON.stringify(validationResult.data, null, 2);
      }
      
      syncResponseParts.push({
        functionResponse: {
          name: TASK_COMPLETE_TOOL_NAME,
          response: { status: 'Task marked complete.' },
          id: callId,
        },
      });
      continue;
    }
    
    // SYNCHRONOUS CASE 2: Unauthorized tools
    if (!allowedToolNames.has(functionCall.name as string)) {
      const error = `Unauthorized tool call: '${functionCall.name}' is not available.`;
      syncResponseParts.push({
        functionResponse: {
          name: functionCall.name as string,
          id: callId,
          response: { error },
        },
      });
      this.emitActivity('ERROR', {
        context: 'tool_call_unauthorized',
        name: functionCall.name,
        error,
      });
      continue;
    }
    
    // ASYNCHRONOUS CASE: Standard tools
    const requestInfo: ToolCallRequestInfo = {
      callId,
      name: functionCall.name as string,
      args,
      isClientInitiated: true,
      prompt_id: promptId,
    };
    
    // Create promise for this tool execution
    const executionPromise = (async () => {
      const { response: toolResponse } = await executeToolCall(
        this.runtimeContext,
        requestInfo,
        signal,
      );
      
      if (toolResponse.error) {
        this.emitActivity('ERROR', {
          context: 'tool_call',
          name: functionCall.name,
          error: toolResponse.error.message,
        });
      } else {
        this.emitActivity('TOOL_CALL_END', {
          name: functionCall.name,
          output: toolResponse.resultDisplay,
        });
      }
      
      return toolResponse.responseParts;
    })();
    
    toolExecutionPromises.push(executionPromise);
  }
  
  // WAIT FOR ALL TOOL EXECUTIONS IN PARALLEL
  const asyncResults = await Promise.all(toolExecutionPromises);
  
  // Combine sync + async results
  const toolResponseParts: Part[] = [...syncResponseParts];
  for (const result of asyncResults) {
    if (result) {
      toolResponseParts.push(...result);
    }
  }
  
  // Build next message
  return {
    nextMessage: { role: 'user', parts: toolResponseParts },
    submittedOutput,
    taskCompleted,
  };
}
```

### Execution Pattern

1. **Early Exit**: Synchronous tools (complete_task, unauthorized) handled immediately
2. **Promise Collection**: Asynchronous tools collected into array WITHOUT waiting
3. **Parallel Execution**: All promises executed concurrently via `Promise.all()`
4. **Result Aggregation**: Results collected and combined into single response
5. **Abort Handling**: All promises receive same abort signal, so cancellation propagates

### Key Insights

1. **Mixed Sync/Async**: Synchronous responses added immediately, async executed in parallel
2. **Single Abort Signal**: All tool executions respect same cancellation signal
3. **No Ordering Guarantee**: Tool results returned in completion order, not call order, but aggregated into single message
4. **Result Deduplication**: Tool calls tracked by ID to avoid duplicate results

---

## 6. Cancellation with Grace Period

### Location
- **Timeout Handling**: `/Users/karaj/Projects/gemini-cli/packages/core/src/agents/executor.ts`, lines 273-357, 366-556

### Timeout Controller Setup

```typescript
// From executor.ts, lines 372-380
const { max_time_minutes } = this.definition.runConfig;
const timeoutController = new AbortController();
const timeoutId = setTimeout(
  () => timeoutController.abort(new Error('Agent timed out.')),
  max_time_minutes * 60 * 1000,
);

// Combine external signal with internal timeout signal
const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
```

### Graceful Recovery Turn

```typescript
// From executor.ts, lines 273-357
private async executeFinalWarningTurn(
  chat: GeminiChat,
  tools: FunctionDeclaration[],
  turnCounter: number,
  reason:
    | AgentTerminateMode.TIMEOUT
    | AgentTerminateMode.MAX_TURNS
    | AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
  externalSignal: AbortSignal,
): Promise<string | null> {
  this.emitActivity('THOUGHT_CHUNK', {
    text: `Execution limit reached (${reason}). Attempting one final recovery turn with a grace period.`,
  });
  
  const recoveryStartTime = Date.now();
  let success = false;
  
  // CREATE GRACE PERIOD: 1 minute timeout for recovery
  const gracePeriodMs = GRACE_PERIOD_MS;  // 60 seconds
  const graceTimeoutController = new AbortController();
  const graceTimeoutId = setTimeout(
    () => graceTimeoutController.abort(new Error('Grace period timed out.')),
    gracePeriodMs,
  );
  
  try {
    const recoveryMessage: Content = {
      role: 'user',
      parts: [{ text: this.getFinalWarningMessage(reason) }],
    };
    
    // Combine external signal with grace period signal
    const combinedSignal = AbortSignal.any([
      externalSignal,
      graceTimeoutController.signal,
    ]);
    
    // Execute ONE final turn with grace period
    const turnResult = await this.executeTurn(
      chat,
      recoveryMessage,
      tools,
      turnCounter,
      combinedSignal,
      graceTimeoutController.signal,  // Pass grace signal to identify grace timeout
    );
    
    // Check if recovery successful
    if (
      turnResult.status === 'stop' &&
      turnResult.terminateReason === AgentTerminateMode.GOAL
    ) {
      success = true;
      this.emitActivity('THOUGHT_CHUNK', {
        text: 'Graceful recovery succeeded.',
      });
      return turnResult.finalResult ?? 'Task completed during grace period.';
    }
    
    // Any other outcome is failure
    this.emitActivity('ERROR', {
      error: `Graceful recovery attempt failed. Reason: ${turnResult.status}`,
      context: 'recovery_turn',
    });
    return null;
  } catch (error) {
    this.emitActivity('ERROR', {
      error: `Graceful recovery attempt failed: ${String(error)}`,
      context: 'recovery_turn',
    });
    return null;
  } finally {
    clearTimeout(graceTimeoutId);
    logRecoveryAttempt(
      this.runtimeContext,
      new RecoveryAttemptEvent(
        this.agentId,
        this.definition.name,
        reason,
        Date.now() - recoveryStartTime,
        success,
        turnCounter,
      ),
    );
  }
}
```

### Final Warning Message

```typescript
// From executor.ts, lines 244-265
private getFinalWarningMessage(
  reason:
    | AgentTerminateMode.TIMEOUT
    | AgentTerminateMode.MAX_TURNS
    | AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
): string {
  let explanation = '';
  switch (reason) {
    case AgentTerminateMode.TIMEOUT:
      explanation = 'You have exceeded the time limit.';
      break;
    case AgentTerminateMode.MAX_TURNS:
      explanation = 'You have exceeded the maximum number of turns.';
      break;
    case AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL:
      explanation = 'You have stopped calling tools without finishing.';
      break;
  }
  return `${explanation} You have one final chance to complete the task with a short grace period. You MUST call \`${TASK_COMPLETE_TOOL_NAME}\` immediately with your best answer and explain that your investigation was interrupted. Do not call any other tools.`;
}
```

### Recovery Attempt Tracking

```typescript
// From executor.ts, lines 436-483
// === UNIFIED RECOVERY BLOCK ===
// Only attempt recovery for recoverable reasons
if (
  terminateReason !== AgentTerminateMode.ERROR &&
  terminateReason !== AgentTerminateMode.ABORTED &&
  terminateReason !== AgentTerminateMode.GOAL
) {
  const recoveryResult = await this.executeFinalWarningTurn(
    chat,
    tools,
    turnCounter,
    terminateReason,
    signal,  // Pass external signal
  );
  
  if (recoveryResult !== null) {
    // Recovery Succeeded
    terminateReason = AgentTerminateMode.GOAL;
    finalResult = recoveryResult;
  } else {
    // Recovery Failed
    if (terminateReason === AgentTerminateMode.TIMEOUT) {
      finalResult = `Agent timed out after ${this.definition.runConfig.max_time_minutes} minutes.`;
      this.emitActivity('ERROR', {
        error: finalResult,
        context: 'timeout',
      });
    }
    // ... similar for other reasons
  }
}
```

### Key Insights

1. **Grace Period**: 60-second window separate from main timeout
2. **Combined Signals**: Grace period signal combined with external signal via `AbortSignal.any()`
3. **Clear Instructions**: Recovery message explicitly tells agent to submit best answer
4. **One-Shot Recovery**: Only ONE recovery turn allowed, then final failure
5. **Telemetry Logging**: Every recovery attempt logged with success/failure status
6. **Error Distinction**: Different final messages for TIMEOUT vs MAX_TURNS vs ERROR_NO_COMPLETE_TASK_CALL

---

## 7. Message Ordering and History Curation

### Location
- **GeminiChat**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/geminiChat.ts`
- **History Extraction**: Lines 150-177

### Curated History Pattern

```typescript
// From geminiChat.ts, lines 150-177
function extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
  if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
    return [];
  }
  
  const curatedHistory: Content[] = [];
  const length = comprehensiveHistory.length;
  let i = 0;
  
  while (i < length) {
    if (comprehensiveHistory[i].role === 'user') {
      // Always include user messages
      curatedHistory.push(comprehensiveHistory[i]);
      i++;
    } else {
      // Collect consecutive model messages
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        // Check if ANY model message is invalid
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }
      // Only include model messages if ALL are valid
      if (isValid) {
        curatedHistory.push(...modelOutput);
      }
    }
  }
  
  return curatedHistory;
}
```

### Valid Content Check

```typescript
// From geminiChat.ts, lines 113-126
function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    // Reject empty text but allow empty thoughts
    if (!part.thought && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}
```

### History Usage in Requests

```typescript
// From geminiChat.ts, lines 290-294
// Add user content to history ONCE before any attempts
this.history.push(userContent);
const requestContents = this.getHistory(true);  // Request uses CURATED history

// Later, in makeApiCallAndProcessStream:
const stream = await this.makeApiCallAndProcessStream(
  model,
  generateContentConfig,
  requestContents,  // Uses curated history (filters invalid)
  prompt_id,
);
```

### Comprehensive History vs Curated

```typescript
// Two separate histories maintained:
// - comprehensive history (all messages, some may be invalid)
// - curated history (only valid messages)

getHistory(curated?: boolean) {
  if (curated) {
    return extractCuratedHistory(this.history);
  }
  return this.history;
}
```

### Stream Processing with Retry Logic

```typescript
// From geminiChat.ts, lines 296-396
const streamWithRetries = async function* (this: GeminiChat): AsyncGenerator<StreamEvent> {
  try {
    let lastError: unknown = new Error('Request failed after all retries.');
    
    let maxAttempts = INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;  // 2 attempts (1 initial + 1 retry)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          yield { type: StreamEventType.RETRY };  // Notify of retry
        }
        
        // On retry, increase temperature for diversity
        if (attempt > 0) {
          generateContentConfig.temperature = 1;
        }
        
        // Make API call with retries
        const stream = await this.makeApiCallAndProcessStream(
          model,
          generateContentConfig,
          requestContents,
          prompt_id,
        );
        
        for await (const chunk of stream) {
          yield { type: StreamEventType.CHUNK, value: chunk };
        }
        
        lastError = null;
        break;  // Success, exit retry loop
      } catch (error) {
        lastError = error;
        const isContentError = error instanceof InvalidStreamError;
        
        if (isContentError && isGemini2Model(model)) {
          if (attempt < maxAttempts - 1) {
            // Log retry and wait with exponential backoff
            logContentRetry(this.config, new ContentRetryEvent(...));
            await new Promise((res) =>
              setTimeout(res, INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs * (attempt + 1))
            );
            continue;
          }
        }
        break;
      }
    }
    
    if (lastError) {
      throw lastError;
    }
  } finally {
    streamDoneResolver!();  // Signal completion
  }
};
```

### Key Insights

1. **Invalid Content Filtering**: Model messages with empty content/parts filtered out
2. **Atomic Batches**: Consecutive model messages treated as unit - all valid or all invalid
3. **Two-Level History**: Comprehensive (all) vs Curated (valid only) for flexibility
4. **Retry on Invalid**: If stream produces invalid content, automatic retry with higher temperature
5. **Message Ordering Guarantee**: User messages always included; model messages grouped by validity

---

## 8. Turn Management and Event Flow

### Location
- **Turn Class**: `/Users/karaj/Projects/gemini-cli/packages/core/src/core/turn.ts`, lines 225-406

### Turn Event System

```typescript
// From turn.ts, lines 50-67, 207-223
export enum GeminiEventType {
  Content = 'content',
  ToolCallRequest = 'tool_call_request',
  ToolCallResponse = 'tool_call_response',
  ToolCallConfirmation = 'tool_call_confirmation',
  UserCancelled = 'user_cancelled',
  Error = 'error',
  ChatCompressed = 'chat_compressed',
  Thought = 'thought',
  MaxSessionTurns = 'max_session_turns',
  Finished = 'finished',
  LoopDetected = 'loop_detected',
  Citation = 'citation',
  Retry = 'retry',
  ContextWindowWillOverflow = 'context_window_will_overflow',
  InvalidStream = 'invalid_stream',
  ModelInfo = 'model_info',
}

export type ServerGeminiStreamEvent =
  | ServerGeminiChatCompressedEvent
  | ServerGeminiCitationEvent
  | ServerGeminiContentEvent
  | ServerGeminiErrorEvent
  | ServerGeminiFinishedEvent
  | ServerGeminiLoopDetectedEvent
  | ServerGeminiMaxSessionTurnsEvent
  | ServerGeminiThoughtEvent
  | ServerGeminiToolCallConfirmationEvent
  | ServerGeminiToolCallRequestEvent
  | ServerGeminiToolCallResponseEvent
  | ServerGeminiUserCancelledEvent
  | ServerGeminiRetryEvent
  | ServerGeminiContextWindowWillOverflowEvent
  | ServerGeminiInvalidStreamEvent
  | ServerGeminiModelInfoEvent;
```

### Turn Execution Flow

```typescript
// From turn.ts, lines 237-367
async *run(
  modelConfigKey: ModelConfigKey,
  req: PartListUnion,
  signal: AbortSignal,
): AsyncGenerator<ServerGeminiStreamEvent> {
  try {
    const responseStream = await this.chat.sendMessageStream(
      modelConfigKey,
      req,
      this.prompt_id,
      signal,
    );
    
    for await (const streamEvent of responseStream) {
      // Check for user cancellation
      if (signal?.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        return;
      }
      
      // Handle RETRY events
      if (streamEvent.type === 'retry') {
        yield { type: GeminiEventType.Retry };
        continue;
      }
      
      const resp = streamEvent.value as GenerateContentResponse;
      if (!resp) continue;
      
      // Store for debug
      this.debugResponses.push(resp);
      const traceId = resp.responseId;
      
      // Extract and emit thoughts
      const thoughtPart = resp.candidates?.[0]?.content?.parts?.[0];
      if (thoughtPart?.thought) {
        const thought = parseThought(thoughtPart.text ?? '');
        yield { type: GeminiEventType.Thought, value: thought, traceId };
        continue;
      }
      
      // Extract and emit text content
      const text = getResponseText(resp);
      if (text) {
        yield { type: GeminiEventType.Content, value: text, traceId };
      }
      
      // Extract and emit function calls
      const functionCalls = resp.functionCalls ?? [];
      for (const fnCall of functionCalls) {
        const event = this.handlePendingFunctionCall(fnCall);
        if (event) {
          yield event;
        }
      }
      
      // Collect citations
      for (const citation of getCitations(resp)) {
        this.pendingCitations.add(citation);
      }
      
      // Check finish reason
      const finishReason = resp.candidates?.[0]?.finishReason;
      if (finishReason) {
        // Emit citations if any
        if (this.pendingCitations.size > 0) {
          yield {
            type: GeminiEventType.Citation,
            value: `Citations:\n${[...this.pendingCitations].sort().join('\n')}`,
          };
          this.pendingCitations.clear();
        }
        
        this.finishReason = finishReason;
        yield {
          type: GeminiEventType.Finished,
          value: {
            reason: finishReason,
            usageMetadata: resp.usageMetadata,
          },
        };
      }
    }
  } catch (e) {
    // Handle cancellation
    if (signal.aborted) {
      yield { type: GeminiEventType.UserCancelled };
      return;
    }
    
    // Handle invalid stream
    if (e instanceof InvalidStreamError) {
      yield { type: GeminiEventType.InvalidStream };
      return;
    }
    
    // Handle other errors
    const error = toFriendlyError(e);
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    
    // Report error
    const contextForReport = [
      ...this.chat.getHistory(true),
      createUserContent(req),
    ];
    await reportError(error, 'Error when talking to Gemini API', contextForReport, 'Turn.run-sendMessageStream');
    
    const structuredError: StructuredError = {
      message: getErrorMessage(error),
      status:
        typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status: number }).status
          : undefined,
    };
    
    yield { type: GeminiEventType.Error, value: { error: structuredError } };
    return;
  }
}
```

### Key Insights

1. **Generator-Based**: Uses async generators for streaming events
2. **Type-Safe Events**: Discriminated union types for all event variants
3. **Sequential Processing**: Events yielded in order as they arrive
4. **Abort Awareness**: Checks abort signal after each event
5. **Debug Tracking**: Stores all responses for debugging/error reporting

---

## 9. Comparison: Gemini-CLI vs. Dexto Approach

### Dimension | Gemini-CLI | Dexto (Proposed) | Trade-offs
---|---|---|---
**Compression Trigger** | 50% threshold | [To be implemented] | Gemini more conservative (safer), could implement dynamic thresholds
**Preservation** | 30% last context | [To be implemented] | Empirically proven in gemini-cli
**Split Logic** | Char-count based at user message boundaries | [To be implemented] | Respects conversation integrity, could add semantic boundaries
**Token Counting** | Heuristic (0.25 ASCII, 1.3 non-ASCII) + API fallback | [To be implemented] | Gemini's ratios well-tuned for Gemini models, may differ for Claude models
**Persistence** | File-based JSON + queued metadata | [To be implemented] | Simple but effective, could add incremental updates
**Tool Execution** | Promise.all() parallel | [To be implemented] | Efficient, respects abort signals
**Cancellation** | AbortSignal.any() + 60s grace period | [To be implemented] | Graceful, gives agent chance to finalize
**History Curation** | Validates all content, filters invalid | [To be implemented] | Prevents API rejects, maintains coherence
**Telemetry** | Rich event logging | [To be implemented] | Comprehensive observability

---

## 10. Strengths and Weaknesses

### Strengths

1. **Robust Compression**: Well-tested strategy with explicit failure detection
2. **Graceful Degradation**: Token estimation falls back to heuristic if API unavailable
3. **Clear Abort Semantics**: `AbortSignal.any()` cleanly combines multiple timeout sources
4. **File Persistence**: Simple JSON-based approach is transparent and debuggable
5. **Queued Metadata**: Handles out-of-order metadata arrival elegantly
6. **Telemetry**: Comprehensive logging enables debugging and optimization
7. **Recovery Turns**: Grace period gives agent one more chance after time/turn limits

### Weaknesses

1. **Token Heuristics Not Model-Agnostic**: ASCII/non-ASCII ratio tuned for Gemini; may not transfer to other models (e.g., Claude)
2. **Compression Overhead**: Calling LLM to summarize adds latency; no adaptive decision on whether compression worth the cost
3. **File-Per-Session**: Storing each session as separate file; no efficient batch queries or cleanup
4. **No Incremental Updates**: Every update reads entire file, modifies, and re-writes
5. **Message Ordering Fragility**: Tool call merging logic complex; potential for race conditions if called out-of-order
6. **Compression Failure Disables**: If compression inflates tokens, disabled for rest of session; could retry later with different strategy
7. **Single Grace Period**: 60 seconds hard-coded; no adaptivity based on agent complexity

---

## 11. Key Learnings for Dexto

### Direct Applicability

1. **Adopt Preserve-Last-30% Strategy**: Empirically tested in production, balances memory vs. freshness
2. **Split at Message Boundaries**: Ensures conversation integrity
3. **Failure-Safe Compression**: Validate token count before/after; disable if worse
4. **Grace Period Recovery**: Single recovery turn with clear instructions highly effective
5. **Parallel Tool Execution**: Use Promise.all() for async tools, handle sync tools immediately

### Model-Specific Considerations

1. **Token Counting**: Validate gemini-cli's 0.25/1.3 ratios against Dexto's model(s). If using Claude, test with actual tokenizer
2. **Compression Prompt**: Adapt XML snapshot template to Dexto's use cases (may need different sections)
3. **Model-Specific Limits**: Update tokenLimits lookup for Claude/Anthropic models

### Implementation Priorities

1. **Phase 1**: Turn execution loop + basic compression (threshold + split logic)
2. **Phase 2**: Token counting heuristics + validation
3. **Phase 3**: Persistence layer + message ordering
4. **Phase 4**: Graceful cancellation with grace periods
5. **Phase 5**: Telemetry and observability

---

## 12. File Reference Guide

| Purpose | File Path | Key Lines |
|---------|-----------|-----------|
| Turn Executor | `packages/core/src/agents/executor.ts` | 182-239 (executeTurn), 366-556 (run) |
| Compression Service | `packages/core/src/services/chatCompressionService.ts` | 101-233 (compress), 43-83 (findCompressSplitPoint) |
| Token Counting | `packages/core/src/utils/tokenCalculation.ts` | 22-41 (heuristic), 48-79 (hybrid) |
| Chat Recording | `packages/core/src/services/chatRecordingService.ts` | 129-177 (init), 233-380 (metadata) |
| Turn Events | `packages/core/src/core/turn.ts` | 237-367 (run), 50-223 (event types) |
| Message Ordering | `packages/core/src/core/geminiChat.ts` | 150-177 (curation), 257-396 (streaming) |
| Tool Processing | `packages/core/src/agents/executor.ts` | 696-914 (processFunctionCalls) |
| Cancellation | `packages/core/src/agents/executor.ts` | 273-357 (executeFinalWarningTurn), 372-380 (setup) |
| Storage Paths | `packages/core/src/config/storage.ts` | 112-116 (history dir) |
| Compression Prompt | `packages/core/src/core/prompts.ts` | 392-450 (getCompressionPrompt) |

---

## 13. Appendix: Code Examples

### Example 1: Minimal Turn Execution

```typescript
async executeTurn(chat, message, tools, turnNum, signal) {
  // 1. Compress if needed
  await this.tryCompressChat(chat, `agent#${turnNum}`);
  
  // 2. Call model
  const { functionCalls } = await this.callModel(
    chat, message, tools, signal, `agent#${turnNum}`
  );
  
  // 3. Check abort
  if (signal.aborted) return { status: 'stop', terminateReason: ABORTED };
  
  // 4. Process tools
  const { nextMessage, taskCompleted } = await this.processFunctionCalls(
    functionCalls, signal, `agent#${turnNum}`
  );
  
  // 5. Decide continuation
  if (taskCompleted) return { status: 'stop', terminateReason: GOAL };
  return { status: 'continue', nextMessage };
}
```

### Example 2: Token Estimation

```typescript
function estimateTokens(text) {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    tokens += code <= 127 ? 0.25 : 1.3;  // ASCII vs non-ASCII
  }
  return Math.floor(tokens);
}
```

### Example 3: Queued Metadata

```typescript
recordThought(thought) {
  this.queuedThoughts.push({ ...thought, timestamp: now() });
}

recordMessage(msg) {
  this.updateConversation((conv) => {
    conv.messages.push({
      ...msg,
      thoughts: this.queuedThoughts,  // Attach queued
      tokens: this.queuedTokens,
    });
    this.queuedThoughts = [];          // Clear queue
    this.queuedTokens = null;
  });
}
```

### Example 4: Parallel Tool Execution

```typescript
async processFunctionCalls(calls) {
  const promises = calls.map(call =>
    executeToolCall(call)  // Returns Promise
  );
  
  const results = await Promise.all(promises);  // Wait all
  
  return { nextMessage: { role: 'user', parts: results } };
}
```

---

**Report Generated**: November 27, 2025  
**Researcher**: Claude Code Analysis  
**Status**: Complete and Ready for Integration Planning
