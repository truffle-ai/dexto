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
    it('keeps min(4k tokens, 10% of the window) inline per result and 40% per step', () => {
        expect(toolOutputBudget(272_000)).toEqual({
            inlineCapChars: 16_000,
            stepBudgetChars: 108_800 * 4,
        });
        expect(toolOutputBudget(40_000)).toEqual({
            inlineCapChars: 4_000 * 4,
            stepBudgetChars: 16_000 * 4,
        });
    });

    it('stores a 30,000 character result on a large window and keeps 16,000 of it inline', () => {
        const budget = toolOutputBudget(272_000);
        const plan = planToolOutputSpills(
            [
                { toolCallId: 'fits', textLength: 16_000 },
                { toolCallId: 'over', textLength: 30_000 },
            ],
            budget
        );
        expect(plan).toEqual(new Map([['over', 16_000]]));

        const fullText = `${'h'.repeat(12_000)}${'m'.repeat(14_000)}${'t'.repeat(4_000)}`;
        const preview = toolResultText(
            withToolOutputPreview(
                result('over', [{ type: 'text', text: fullText }]),
                fullText,
                16_000
            )
        );
        expect(preview.startsWith('h'.repeat(11_000))).toBe(true);
        expect(preview.endsWith('t'.repeat(3_000))).toBe(true);
        expect(preview).not.toContain('mm');
        expect(preview).toContain('of 30000 characters.');
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

    it('cuts parallel results on a small window', () => {
        const plan = planToolOutputSpills(
            [
                ...Array.from({ length: 5 }, (_, index) => ({
                    toolCallId: `call-${index}`,
                    textLength: 1_500,
                })),
                { toolCallId: 'd', textLength: 100 },
            ],
            toolOutputBudget(2_500)
        );

        expect([...plan.values()].reduce((sum, chars) => sum + chars, 0) + 100).toBeLessThanOrEqual(
            4_000
        );
    });

    it('cuts capped parallel results to fit the real step budget', () => {
        const budget = toolOutputBudget(272_000);
        const results = Array.from({ length: 28 }, (_, index) => ({
            toolCallId: `call-${index}`,
            textLength: 30_000,
        }));
        const plan = planToolOutputSpills(results, budget);
        expect(plan.get('call-0')).toBe(8_000);
        expect([...plan.values()].reduce((sum, chars) => sum + chars, 0)).toBeLessThanOrEqual(
            budget.stepBudgetChars
        );
    });

    it('fits parallel results within real step budgets whenever complete markers fit', () => {
        for (const window of [272_000, 40_000, 2_500]) {
            const budget = toolOutputBudget(window);
            for (const length of [30_000, Math.floor(budget.inlineCapChars / 2) - 1]) {
                for (let count = 1; count <= 300; count++) {
                    const results = Array.from({ length: count }, (_, i) => ({
                        toolCallId: `call-${String(i).padStart(16, '0')}`,
                        textLength: length,
                    }));
                    const plan = planToolOutputSpills(results, budget);
                    const inline = results.reduce(
                        (sum, item) => sum + (plan.get(item.toolCallId) ?? item.textLength),
                        0
                    );
                    const minimum = results.reduce((sum, item) => {
                        const text = 'x'.repeat(item.textLength);
                        const marker = toolResultText(
                            withToolOutputPreview(
                                result(item.toolCallId, [{ type: 'text', text }]),
                                text,
                                0
                            )
                        );
                        return sum + Math.min(item.textLength, marker.length);
                    }, 0);
                    expect(inline).toBeLessThanOrEqual(Math.max(budget.stepBudgetChars, minimum));
                }
            }
        }
    });

    it('keeps fitting results unchanged and never cuts read instructions at the minimum', () => {
        const budget = { inlineCapChars: 1_000, stepBudgetChars: 500 };
        expect(planToolOutputSpills([{ toolCallId: 'fits', textLength: 500 }], budget).size).toBe(
            0
        );
        const id = 'a'.repeat(300);
        const text = 'x'.repeat(10_000);
        const plan = planToolOutputSpills([{ toolCallId: id, textLength: text.length }], budget);
        const preview = toolResultText(
            withToolOutputPreview(result(id, [{ type: 'text', text }]), text, plan.get(id)!)
        );
        expect(preview).toContain('instead of re-running the tool.]');
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

        expect(plan).toEqual(
            new Map([
                ['b', 40_000],
                ['c', 40_000],
            ])
        );
    });
});

describe('withToolOutputPreview', () => {
    it('counts the marker within the cap at the boundary', () => {
        const fullText = 'x'.repeat(16_001);
        const text = toolResultText(
            withToolOutputPreview(
                result('id', [{ type: 'text', text: fullText }]),
                fullText,
                16_000
            )
        );
        expect(text.length).toBeLessThanOrEqual(16_000);
        expect(text).toContain('tool_output_read');
    });

    it('does not split surrogate pairs at either preview boundary', () => {
        const makePreview = (text: string) =>
            toolResultText(
                withToolOutputPreview(result('id', [{ type: 'text', text }]), text, 1_000)
            );
        const baseline = makePreview('x'.repeat(4_000));
        const match = /first (\d+) and last (\d+)/.exec(baseline);
        expect(match).not.toBeNull();
        const head = Number(match?.[1]);
        const tail = Number(match?.[2]);
        const text = `${'x'.repeat(head - 1)}😀${'x'.repeat(4_000 - head - tail - 2)}😀${'x'.repeat(tail - 1)}`;
        const preview = makePreview(text);
        expect(preview).not.toMatch(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
        );
    });

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
        expect(text.startsWith('h'.repeat(500))).toBe(true);
        expect(text.endsWith('t'.repeat(150))).toBe(true);
        expect(text).not.toContain('mmmm');
        expect(text).toContain('tool_output_read({ "id": "call-1"');
        expect(text).toContain('of 6000 characters');
    });
});
