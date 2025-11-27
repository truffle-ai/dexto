# Gemini-CLI Research: Quick Reference

**Full Report**: `/Users/karaj/Projects/dexto-new-agents/gemini-cli-research-findings.md` (50KB, 1589 lines)

## Research Completed For

1. **Custom Turn Execution Loop** (Section 1)
   - State machine with compress → call → check → process → continue pattern
   - File: `executor.ts` lines 182-239, 366-556
   - Key: Discriminated union result types for explicit state transitions

2. **Compression Strategy** (Section 2)
   - 50% threshold, 30% preservation, LLM-driven summaries
   - File: `chatCompressionService.ts` lines 101-233
   - Key: Validates compression doesn't inflate tokens; disables on failure

3. **Token Counting** (Section 3)
   - Heuristic: 0.25 tokens/ASCII char, 1.3 tokens/non-ASCII char
   - API fallback for media (images, files)
   - File: `tokenCalculation.ts` lines 22-79

4. **File-Based Persistence** (Section 4)
   - JSON sessions in `~/.gemini/tmp/<project_hash>/chats/`
   - Queued metadata pattern: accumulate then attach to message
   - File: `chatRecordingService.ts` lines 110-438

5. **Parallel Tool Execution** (Section 5)
   - `Promise.all()` for async tools, immediate response for sync tools
   - File: `executor.ts` lines 696-914
   - Key: Sync (complete_task, unauthorized) handled immediately; async collected and awaited

6. **Graceful Cancellation** (Section 6)
   - AbortSignal.any() combines external + timeout + grace period signals
   - 60-second recovery turn with clear instructions
   - File: `executor.ts` lines 273-357, 372-380

7. **Message Ordering** (Section 7)
   - Curated history filters invalid model responses (empty content, etc.)
   - Two-level history: comprehensive vs. curated
   - File: `geminiChat.ts` lines 150-396

8. **Turn Management** (Section 8)
   - Turn class manages streaming events, collects tool calls
   - Async generator pattern for event streaming
   - File: `turn.ts` lines 237-367

## Key Metrics

| Dimension | Value |
|-----------|-------|
| Compression Threshold | 50% of model token limit |
| Preserve Last | 30% of context |
| Grace Period | 60 seconds |
| Retry Attempts | 2 (1 initial + 1 with higher temperature) |
| Token Ratios | ASCII: 0.25/char, Non-ASCII: 1.3/char |
| Model Token Limits | 1M - 2M range (Gemini variants) |

## Comparison: What Dexto Should Consider

### Direct Adoption
- Preserve-Last-30% strategy (empirically tested)
- Split at message boundaries (maintains conversation integrity)
- Failure-safe compression (validate before/after)
- Grace period recovery (highly effective)
- Parallel tool execution with `Promise.all()`

### Model-Specific Adjustments
- Token ratios: Validate 0.25/1.3 for Claude models
- Compression prompt: Adapt XML template to Dexto's use cases
- Token limits: Update for Anthropic models
- Recovery message: Customize for Dexto's agent types

### Implementation Roadmap
1. **Phase 1**: Turn loop + basic compression
2. **Phase 2**: Token counting + validation
3. **Phase 3**: Persistence + message ordering
4. **Phase 4**: Cancellation + grace periods
5. **Phase 5**: Telemetry & observability

## Notable Patterns

### Queued Metadata Pattern
Thoughts and token data queued during streaming, attached when message completes:
```typescript
recordThought(thought) { this.queuedThoughts.push(thought); }
recordMessage(msg) {
  msg.thoughts = this.queuedThoughts;  // Attach queued
  this.queuedThoughts = [];             // Clear queue
}
```

### Turnstile Pattern
Each turn: compress → call → check signals → process tools → decide continuation

### Change Detection
Prevent unnecessary disk writes by comparing JSON strings before writing

## File Navigation

| Purpose | Path | Lines |
|---------|------|-------|
| Main Executor | `packages/core/src/agents/executor.ts` | 182-914 |
| Compression | `packages/core/src/services/chatCompressionService.ts` | 29-233 |
| Token Utils | `packages/core/src/utils/tokenCalculation.ts` | 10-79 |
| Chat Recording | `packages/core/src/services/chatRecordingService.ts` | 110-438 |
| Turn Handler | `packages/core/src/core/turn.ts` | 237-367 |
| History Management | `packages/core/src/core/geminiChat.ts` | 150-396 |
| Compression Prompt | `packages/core/src/core/prompts.ts` | 392-450 |

## Report Structure

The full report contains:
- Executive summary with 6 key innovations
- 8 detailed sections on each dimension
- Side-by-side code examples with line numbers
- Compression algorithm deep-dive with XML template
- Strengths & weaknesses analysis
- Direct learnings for Dexto
- Appendix with 4 minimal code examples
- 12-file reference guide

---

**Generated**: November 27, 2025  
**Source Project**: /Users/karaj/Projects/gemini-cli (Google's Gemini CLI Agent)  
**Status**: Ready for implementation planning
