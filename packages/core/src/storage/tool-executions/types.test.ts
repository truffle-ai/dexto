import { describe, expect, it } from 'vitest';

import { createToolExecutionId } from './types.js';

describe('createToolExecutionId', () => {
    it('includes the owning parent in nested execution identity', () => {
        const base = {
            modelStepId: 'step-1',
            runId: 'run-1',
            toolCallId: 'child-1',
            turnId: 'turn-1',
        };

        const first = createToolExecutionId({ ...base, parentToolCallId: 'outer-1' });
        const second = createToolExecutionId({ ...base, parentToolCallId: 'outer-2' });

        expect(first).toMatch(/^tool-exec-[a-f0-9]{64}$/u);
        expect(first).not.toBe(second);
    });
});
