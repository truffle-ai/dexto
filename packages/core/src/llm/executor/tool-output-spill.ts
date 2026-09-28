import type { ContentPart, SanitizedToolResult } from '../../context/types.js';

/** The core tool that pages through stored tool output. */
export const TOOL_OUTPUT_READ_TOOL_NAME = 'tool_output_read';

const CHARS_PER_TOKEN = 4;
/** One result keeps at most min(25k tokens, 10% of the input window) inline. */
const MAX_INLINE_TOKENS = 25_000;
const INLINE_WINDOW_RATIO = 0.1;
/** One step's results together keep at most 40% of the input window inline. */
const STEP_WINDOW_RATIO = 0.4;
/** A result stored only to fit the step budget keeps this much inline, or its cap if smaller. */
const STEP_SPILL_PREVIEW_CHARS = 16_000;
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
 * inline. Every result over the inline cap is stored; if the rest still exceed the step budget,
 * the largest are stored next (earlier calls first on ties) so the decision is deterministic.
 */
export function planToolOutputSpills(
    results: ReadonlyArray<{ toolCallId: string; textLength: number }>,
    budget: ToolOutputBudget
): Map<string, number> {
    const previewChars = new Map<string, number>();
    let inlineChars = 0;
    for (const result of results) {
        if (result.textLength > budget.inlineCapChars) {
            previewChars.set(result.toolCallId, budget.inlineCapChars);
            inlineChars += budget.inlineCapChars;
        } else {
            inlineChars += result.textLength;
        }
    }
    const stepPreviewChars = Math.min(budget.inlineCapChars, STEP_SPILL_PREVIEW_CHARS);
    const largestFirst = results
        .filter((result) => !previewChars.has(result.toolCallId))
        .filter((result) => result.textLength > stepPreviewChars)
        .sort((left, right) => right.textLength - left.textLength);
    for (const result of largestFirst) {
        if (inlineChars <= budget.stepBudgetChars) break;
        previewChars.set(result.toolCallId, stepPreviewChars);
        inlineChars -= result.textLength - stepPreviewChars;
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
    const headChars = Math.floor(previewChars * PREVIEW_HEAD_RATIO);
    const tailChars = previewChars - headChars;
    const id = result.meta.toolCallId;
    const preview =
        `${fullText.slice(0, headChars)}\n\n` +
        `[Output truncated: showing the first ${headChars} and last ${tailChars} of ${fullText.length} characters. ` +
        `The full output is stored. Read any part with ${TOOL_OUTPUT_READ_TOOL_NAME}({ "id": "${id}", "offset": <line> }) ` +
        `or search it with ${TOOL_OUTPUT_READ_TOOL_NAME}({ "id": "${id}", "pattern": "<text>" }) instead of re-running the tool.]\n\n` +
        fullText.slice(fullText.length - tailChars);
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
