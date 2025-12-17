# Outside Diff Range Comments - PR #498

Tracking CodeRabbit review comments that were flagged as "outside diff range".

## Summary

| Status | Count |
|--------|-------|
| Fixed | 9 |
| Pending | 6 |
| Skipped | 0 |

---

## 1. OverlayContainer.tsx - Buffer sync in handleResourceSelect

**Source**: Reviews 3573414924, 3587818365
**Status**: ✅ Fixed

**Issue**: `handleResourceSelect` updates `input.value` state but doesn't sync `buffer` (the source of truth). Other handlers consistently update both.

**Fix**: Added `buffer.setText(newValue)` and included `buffer` in dependency array.

---

## 2. OverlayContainer.tsx - Missing buffer in useCallback deps (8 instances)

**Source**: Review 3572699773
**Status**: ✅ Fixed

**Issue**: Multiple callbacks call `buffer.setText(...)` but don't list `buffer` in dependencies.

**Fixed handlers**:
- `handleSearchResultSelect`
- `handleSystemCommandSelect`
- `handleLogLevelSelect`
- `handleStreamSelect`
- `handleMcpServerAction`
- `handleMcpAddSelect`
- `handleMcpCustomWizardComplete`
- `handleSessionSubcommandSelect`

**Fix**: Added `buffer` to each useCallback dependency array.

---

## 3. useAgentEvents.ts - Add setQueuedMessages([]) to reset handlers

**Source**: Review 3572699773
**Status**: ✅ Fixed

**Issue**: When conversation resets or context clears, queued messages should be cleared. Currently missing from `session:reset` and `context:cleared` handlers.

**Fix**: Added `setQueuedMessages([])` to both `session:reset` and `context:cleared` handlers.

---

## 4. general-commands.ts - Remove console.log calls

**Source**: Reviews 3572699773, 3573414924
**Status**: ⏳ Pending

**Issue**: Command handlers both log to console AND return Ink-formatted output, causing overlapping/duplicated output. Should only return results through `CommandHandlerResult`.

**Affected**: `/help`, `/exit`, `/clear`, `/copy`, `/shortcuts`

**Fix**: Remove `console.log` calls, keep only return statements.

---

## 5. SlashCommandAutocomplete.tsx - Guard onSubmitRaw rejections

**Source**: Review 3573414924
**Status**: ✅ Fixed

**Issue**: `onSubmitRaw` can return a Promise, but `handleInput` calls it without handling rejection. Could cause unhandled promise rejections.

**Fix**: Changed `console.error` to `agent.logger.error` in the catch block, added `agent` to useImperativeHandle deps.

---

## 6. SlashCommandAutocomplete.tsx - Loading state unreachable

**Source**: Review 3573414924
**Status**: ✅ Fixed

**Issue**: When overlay first opens, `isLoading=true` while `combinedItems` is empty, but component returns `null` before hitting loading UI due to early `combinedItems.length === 0` check.

**Fix**: Moved `isLoading` check before the `combinedItems.length === 0` check.

---

## 7. useApprovals.ts - Missing response.ok check

**Source**: Review 3572699773
**Status**: ✅ Already Fixed

**Issue**: `useSubmitApproval` mutation doesn't check `response.ok` before `response.json()`, which can turn server errors into confusing JSON parse errors.

**Resolution**: Already fixed - both `useSubmitApproval` (lines 20-22) and `usePendingApprovals` (lines 50-52) have proper `if (!response.ok)` checks.

---

## 8. mcp.ts routes - API response when enabled=false

**Source**: Review 3572699773
**Status**: ✅ Fixed

**Issue**: When `config.enabled === false`, `agent.addMcpServer()` skips connection but API returns `{ status: 'connected' }` which is misleading.

**Fix**: Return `{ status: 'registered' }` when server is disabled, `{ status: 'connected' }` only when actually connected.

---

## 9. DextoAgent.ts - removeMcpServer error handling

**Source**: Review 3587250159
**Status**: ✅ Fixed

**Issue**: Unlike `enableMcpServer` and `disableMcpServer`, `removeMcpServer` lacks error handling. If `removeClient()` throws, state becomes inconsistent.

**Fix**: Wrap in try/catch, log error, throw typed `MCPError.disconnectionFailed`.

---

## 10. LogLevelSelector.tsx - Reset logFilePath when overlay hides

**Source**: Review 3572699773
**Status**: ⏳ Pending

**Issue**: `logFilePath` persists after hiding, and UI row renders whenever set (even if `isVisible` is false).

**Fix**: Clear `logFilePath` when not visible, or gate render on `isVisible`.

---

## 11. SlashCommandAutocomplete.tsx - (mcp) marker unconditional

**Source**: Review 3572699773
**Status**: ⏳ Pending

**Issue**: Line 563-564 appends ` (mcp)` for every prompt item, but prompts can come from config or custom sources too.

**Fix**: Only show `(mcp)` marker when `prompt.source === 'mcp'`.

---

## 12. ModelSelectorRefactored.tsx - Logger call violates guidelines

**Source**: Review 3572699773
**Status**: ⏳ Pending

**Issue**: Logger calls use extra arg object + non-template patterns, violating repo logging guidelines.

**Fix**: Use single template-literal message including error details.

---

## 13. model-commands.ts - console.log + stale help text

**Source**: Review 3572699773
**Status**: ⏳ Pending

**Issue**:
1. Interactive commands rely on `console.log` + `noOutput()` which breaks Ink
2. Help text says "openai, anthropic, gemini" but supported providers are broader

**Fix**: Return styled output instead of console.log; update provider list.

---

## 14. prompt-commands.ts - Prevent displayName collisions

**Source**: Review 3573414924
**Status**: ⏳ Pending

**Issue**: Multiple prompts can share the same `displayName`, causing one command to overwrite another in the registry.

**Fix**: Enforce displayName uniqueness or append suffix when collisions detected.

---

## 15. context/utils.ts - Strip _display before normalization

**Source**: Review 3579635763
**Status**: ⏳ Pending

**Issue**: `sanitizeToolResult` extracts `_display` into `meta.display` but still passes full `result` (including `_display`) into `normalizeToolResult`, duplicating large display payloads in LLM content.

**Fix**: Strip `_display` from payload before normalization while preserving in `meta.display`.

---

## Skipped Items

Items intentionally not addressed (with reasons):

_None yet_
