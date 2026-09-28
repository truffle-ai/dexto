import { createHash } from 'crypto';
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

    it('keeps the pre-nesting ID for top-level executions', () => {
        const legacyKey = JSON.stringify(['run-1', 'turn-1', 'step-1', 'call-1']);

        expect(
            createToolExecutionId({
                modelStepId: 'step-1',
                runId: 'run-1',
                toolCallId: 'call-1',
                turnId: 'turn-1',
            })
        ).toBe(`tool-exec-${createHash('sha256').update(legacyKey).digest('hex')}`);
    });
});
