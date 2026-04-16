import { context, propagation } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
    getHostRuntimeBaggageEntries,
    getHostRuntimeContextFromBaggage,
    normalizeHostRuntimeContext,
    resolveHostRuntimeContext,
} from './host-runtime.js';

describe('host runtime context', () => {
    it('normalizes host runtime context into an immutable value', () => {
        const hostRuntime = normalizeHostRuntimeContext({
            ids: {
                runId: 'run-1',
                attemptId: 'attempt-1',
            },
        });

        expect(hostRuntime).toEqual({
            ids: {
                runId: 'run-1',
                attemptId: 'attempt-1',
            },
        });
        expect(Object.isFrozen(hostRuntime)).toBe(true);
        expect(Object.isFrozen(hostRuntime?.ids)).toBe(true);
    });

    it('resolves one consistent host runtime context when overriding runId', () => {
        const hostRuntime = resolveHostRuntimeContext({
            inherited: normalizeHostRuntimeContext({
                ids: {
                    runId: 'parent-run',
                    attemptId: 'attempt-1',
                },
            }),
            runId: 'child-run',
        });

        expect(hostRuntime).toEqual({
            ids: {
                runId: 'child-run',
                attemptId: 'attempt-1',
            },
        });
        expect(Object.isFrozen(hostRuntime)).toBe(true);
        expect(Object.isFrozen(hostRuntime?.ids)).toBe(true);
    });

    it('reconstructs immutable host runtime IDs from baggage', () => {
        const baggage = propagation.createBaggage(
            getHostRuntimeBaggageEntries({
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            })
        );
        const currentContext = propagation.setBaggage(context.active(), baggage);
        const hostRuntime = getHostRuntimeContextFromBaggage(currentContext);

        expect(hostRuntime).toEqual({
            ids: {
                runId: 'run-1',
                attemptId: 'attempt-1',
            },
        });
        expect(Object.isFrozen(hostRuntime)).toBe(true);
        expect(Object.isFrozen(hostRuntime?.ids)).toBe(true);
    });

    it('ignores invalid host runtime baggage entries while reconstructing context', () => {
        const baggage = propagation.createBaggage({
            'hostRuntime.ids.foo+bar': { value: 'invalid-key' },
            'hostRuntime.ids.emptyValue': { value: '   ' },
            'hostRuntime.ids.runId': { value: 'run-1' },
            attemptId: { value: 'attempt-1' },
        });
        const currentContext = propagation.setBaggage(context.active(), baggage);

        const hostRuntime = getHostRuntimeContextFromBaggage(currentContext);

        expect(hostRuntime).toEqual({
            ids: {
                runId: 'run-1',
                attemptId: 'attempt-1',
            },
        });
        expect(Object.isFrozen(hostRuntime)).toBe(true);
        expect(Object.isFrozen(hostRuntime?.ids)).toBe(true);
    });
});
