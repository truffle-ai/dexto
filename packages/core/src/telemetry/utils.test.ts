import { context, propagation } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { getHostRuntimeBaggageEntries } from '../runtime/index.js';
import { addBaggageAttributesToSpan, getBaggageValues } from './utils.js';

describe('telemetry baggage utilities', () => {
    it('extracts host runtime IDs from baggage', () => {
        const baggage = propagation.createBaggage({
            ...getHostRuntimeBaggageEntries({
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            }),
            sessionId: { value: 'session-1' },
        });
        const ctx = propagation.setBaggage(context.active(), baggage);

        expect(getBaggageValues(ctx)).toMatchObject({
            sessionId: 'session-1',
            runId: 'run-1',
            hostRuntime: {
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            },
        });
    });

    it('adds host runtime IDs to span attributes', () => {
        const span = {
            setAttribute: vi.fn(),
        } as unknown as import('@opentelemetry/api').Span;
        const baggage = propagation.createBaggage(
            getHostRuntimeBaggageEntries({
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            })
        );
        const ctx = propagation.setBaggage(context.active(), baggage);

        addBaggageAttributesToSpan(span, ctx);

        expect(span.setAttribute).toHaveBeenCalledWith('runId', 'run-1');
        expect(span.setAttribute).toHaveBeenCalledWith('hostRuntime.ids.runId', 'run-1');
        expect(span.setAttribute).toHaveBeenCalledWith('hostRuntime.ids.attemptId', 'attempt-1');
    });
});
