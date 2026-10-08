import { describe, expect, it } from 'vitest';
import type { SanitizedToolResult } from '../../context/types.js';
import {
    planToolOutputSpills,
    toolOutputBudget,
    toolResultText,
    withToolOutputPreview,
} from './tool-output-spill.js';

function result(toolCallId: string, content: SanitizedToolResult['content']): SanitizedToolResult {
    return { content, meta: { toolName: 'read_file', toolCallId, success: true } };
}

describe('toolOutputBudget', () => {
    it('keeps min(6k tokens, 10% of the window) inline per result and 40% per step', () => {
        expect(toolOutputBudget(272_000)).toEqual({
            inlineCapChars: 24_000,
            stepBudgetChars: 108_800 * 4,
        });
        expect(toolOutputBudget(40_000)).toEqual({
            inlineCapChars: 4_000 * 4,
            stepBudgetChars: 16_000 * 4,
        });
    });

    it('stores a 30,000 character result on a large window and keeps 24,000 of it inline', () => {
        const budget = toolOutputBudget(272_000);
        const plan = planToolOutputSpills(
            [
                { toolCallId: 'fits', textLength: 24_000 },
                { toolCallId: 'over', textLength: 30_000 },
            ],
            budget
        );
        expect(plan).toEqual(new Map([['over', 24_000]]));

        const fullText = `${'h'.repeat(18_000)}${'m'.repeat(6_000)}${'t'.repeat(6_000)}`;
        const preview = toolResultText(
            withToolOutputPreview(
                result('over', [{ type: 'text', text: fullText }]),
                fullText,
                24_000
            )
        );
        expect(preview.startsWith('h'.repeat(18_000))).toBe(true);
        expect(preview.endsWith('t'.repeat(6_000))).toBe(true);
        expect(preview).not.toContain('mm');
        expect(preview).toContain(
            '[Output truncated: showing the first 18000 and last 6000 of 30000 characters.'
        );
        expect(preview).toContain('tool_output_read({ "id": "over", "offset": <line> })');
        expect(preview).toContain('tool_output_read({ "id": "over", "pattern": "<text>" })');
    });
});

describe('planToolOutputSpills', () => {
    const budget = { inlineCapChars: 1_000, stepBudgetChars: 2_500 };

    it('stores every result over the inline cap with a preview of the cap', () => {
        expect(
            planToolOutputSpills(
                [
                    { toolCallId: 'small', textLength: 500 },
                    { toolCallId: 'large', textLength: 5_000 },
                ],
                budget
            )
        ).toEqual(new Map([['large', 1_000]]));
    });

    it('stores nothing more when no result is larger than the step preview', () => {
        const plan = planToolOutputSpills(
            [
                { toolCallId: 'a', textLength: 900 },
                { toolCallId: 'b', textLength: 950 },
                { toolCallId: 'c', textLength: 950 },
                { toolCallId: 'd', textLength: 100 },
            ],
            { inlineCapChars: 1_000, stepBudgetChars: 1_500 }
        );

        // The step preview is capped at the inline cap (1,000), so storing these would not shrink
        // them.
        expect(plan).toEqual(new Map());
    });

    it('cuts results already at the inline cap further when together they exceed the step budget', () => {
        // Nineteen 30,000 character results on a 272k window: 19 x 24,000 = 456,000 characters
        // inline against a 435,200 character step budget, so three drop to the 16,000 preview.
        const results = Array.from({ length: 19 }, (_, index) => ({
            toolCallId: `call-${index}`,
            textLength: 30_000,
        }));

        const plan = planToolOutputSpills(results, toolOutputBudget(272_000));

        expect(plan.size).toBe(19);
        expect([...plan.entries()].filter(([, chars]) => chars === 16_000)).toEqual([
            ['call-0', 16_000],
            ['call-1', 16_000],
            ['call-2', 16_000],
        ]);
        const inline = [...plan.values()].reduce((sum, chars) => sum + chars, 0);
        expect(inline).toBe(432_000);
        expect(inline).toBeLessThanOrEqual(toolOutputBudget(272_000).stepBudgetChars);
    });

    it('prefers the largest result, earlier calls first on ties, for the step budget', () => {
        const plan = planToolOutputSpills(
            [
                { toolCallId: 'a', textLength: 60_000 },
                { toolCallId: 'b', textLength: 70_000 },
                { toolCallId: 'c', textLength: 70_000 },
            ],
            { inlineCapChars: 80_000, stepBudgetChars: 150_000 }
        );

        expect(plan).toEqual(new Map([['b', 16_000]]));
    });
});

describe('withToolOutputPreview', () => {
    it('keeps the head and tail, names the read tool, and keeps non-text parts', () => {
        const fullText = `${'h'.repeat(750)}${'m'.repeat(5_000)}${'t'.repeat(250)}`;
        const image = { type: 'image' as const, image: '@blob:1', mimeType: 'image/png' };
        const preview = withToolOutputPreview(
            result('call-1', [{ type: 'text', text: fullText }, image]),
            fullText,
            1_000
        );

        expect(preview.content).toHaveLength(2);
        expect(preview.content[1]).toEqual(image);
        const text = toolResultText(preview);
        expect(text.startsWith('h'.repeat(750))).toBe(true);
        expect(text.endsWith('t'.repeat(250))).toBe(true);
        expect(text).not.toContain('mmmm');
        expect(text).toContain('tool_output_read({ "id": "call-1"');
        expect(text).toContain('of 6000 characters');
    });
});
