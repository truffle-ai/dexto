import { safeTextBoundary } from '../../utils/text-boundary.js';
import type { ContentPart, SanitizedToolResult } from '../../context/types.js';

/** The core tool that pages through stored tool output. */
export const TOOL_OUTPUT_READ_TOOL_NAME = 'tool_output_read';

const CHARS_PER_TOKEN = 4;
/**
 * One result keeps at most min(4k tokens, 10% of the input window) inline: about 16,000 characters.
 * A result stays in the history for every later step of the chat, so a large one is paid for again
 * on each step; the rest is stored and read on demand.
 */
const MAX_INLINE_TOKENS = 4_000;
const INLINE_WINDOW_RATIO = 0.1;
/** One step's results together keep at most 40% of the input window inline. */
const STEP_WINDOW_RATIO = 0.4;
const PREVIEW_HEAD_RATIO = 0.75;

export interface ToolOutputBudget {
    inlineCapChars: number;
    stepBudgetChars: number;
}

export function toolOutputBudget(maxInputTokens: number): ToolOutputBudget {
    return {
        inlineCapChars:
            Math.min(MAX_INLINE_TOKENS, Math.floor(maxInputTokens * INLINE_WINDOW_RATIO)) *
            CHARS_PER_TOKEN,
        stepBudgetChars: Math.floor(maxInputTokens * STEP_WINDOW_RATIO) * CHARS_PER_TOKEN,
    };
}

export function toolResultText(result: SanitizedToolResult): string {
    return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

/**
 * Decides which of one step's results to store outside history, and how much of each to keep
 * inline. Every result over the inline cap is stored; if the step still exceeds its budget, the
 * largest results, stored or not, are cut to the step preview (earlier calls first on ties) so the
 * decision is deterministic.
 */
export function planToolOutputSpills(
    results: ReadonlyArray<{ toolCallId: string; textLength: number }>,
    budget: ToolOutputBudget
): Map<string, number> {
    const previewChars = new Map<string, number>();
    let inlineChars = 0;
    for (const result of results) {
        if (result.textLength > budget.inlineCapChars) {
            const cap = Math.max(
                budget.inlineCapChars,
                outputMarker(result.toolCallId, result.textLength, 0, 0).length
            );
            if (cap < result.textLength) {
                previewChars.set(result.toolCallId, cap);
                inlineChars += cap;
            } else {
                inlineChars += result.textLength;
            }
        } else {
            inlineChars += result.textLength;
        }
    }
    // A result already cut to the inline cap can be cut again to the smaller step preview.
    const stepPreviewChars = Math.floor(budget.inlineCapChars / 2);
    const largestFirst = results
        .filter((result) => result.textLength > stepPreviewChars)
        .sort((left, right) => right.textLength - left.textLength);
    for (const result of largestFirst) {
        if (inlineChars <= budget.stepBudgetChars) break;
        const inlineNow = previewChars.get(result.toolCallId) ?? result.textLength;
        const target = Math.max(
            stepPreviewChars,
            outputMarker(result.toolCallId, result.textLength, 0, 0).length
        );
        if (inlineNow <= target) continue;
        previewChars.set(result.toolCallId, target);
        inlineChars -= inlineNow - target;
    }
    if (inlineChars <= budget.stepBudgetChars) return previewChars;

    // If previews alone exceed the budget, reduce the largest remaining inline results.
    // A full marker is the irreducible minimum, unless the original text is shorter.
    for (const result of [...results].sort(
        (a, b) =>
            (previewChars.get(b.toolCallId) ?? b.textLength) -
            (previewChars.get(a.toolCallId) ?? a.textLength)
    )) {
        if (inlineChars <= budget.stepBudgetChars) break;
        const inlineNow = previewChars.get(result.toolCallId) ?? result.textLength;
        const minimum = outputMarker(result.toolCallId, result.textLength, 0, 0).length;
        const target = Math.max(minimum, inlineNow - (inlineChars - budget.stepBudgetChars));
        if (target >= inlineNow) continue;
        previewChars.set(result.toolCallId, target);
        inlineChars -= inlineNow - target;
    }
    return previewChars;
}

/**
 * Replaces a result's text parts with one head and tail preview of the full text, followed by a
 * marker telling the model how to read the rest. Non-text parts are kept.
 */
export function withToolOutputPreview(
    result: SanitizedToolResult,
    fullText: string,
    previewChars: number
): SanitizedToolResult {
    const id = result.meta.toolCallId;
    const marker = (head: number, tail: number) => outputMarker(id, fullText.length, head, tail);
    // Reserve enough space even if the counts in the marker have the maximum number of digits.
    const available = Math.max(0, previewChars - marker(previewChars, previewChars).length);
    const headChars = safeTextBoundary(fullText, Math.floor(available * PREVIEW_HEAD_RATIO));
    const tailStart = fullText.length - (available - Math.floor(available * PREVIEW_HEAD_RATIO));
    const safeTailStart =
        safeTextBoundary(fullText, tailStart) === tailStart ? tailStart : tailStart + 1;
    const tailChars = fullText.length - safeTailStart;
    const previewMarker = marker(headChars, tailChars);
    const preview = fullText.slice(0, headChars) + previewMarker + fullText.slice(safeTailStart);
    const content: ContentPart[] = [];
    let previewAdded = false;
    for (const part of result.content) {
        if (part.type !== 'text') {
            content.push(part);
        } else if (!previewAdded) {
            content.push({ type: 'text', text: preview });
            previewAdded = true;
        }
    }
    return { ...result, content };
}

function outputMarker(id: string, length: number, head: number, tail: number): string {
    return (
        `\n\n[Output truncated: showing the first ${head} and last ${tail} of ${length} characters. ` +
        `The full output is stored. Read any part with ${TOOL_OUTPUT_READ_TOOL_NAME}({ "id": "${id}", "offset": <line> }) ` +
        `or search it with ${TOOL_OUTPUT_READ_TOOL_NAME}({ "id": "${id}", "pattern": "<text>" }) instead of re-running the tool.]\n\n`
    );
}
