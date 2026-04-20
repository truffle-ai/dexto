import { context, propagation } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { getHostRuntimeBaggageEntries, getHostRuntimeContextFromBaggage } from './host-runtime.js';
import { createAgentRunContext } from './run-context.js';

describe('agent run context', () => {
    it('clears inherited host runtime baggage when a run omits host runtime', () => {
        const parentContext = propagation.setBaggage(
            context.active(),
            propagation.createBaggage({
                ...getHostRuntimeBaggageEntries({
                    ids: {
                        runId: 'parent-run',
                        attemptId: 'attempt-1',
                    },
                }),
                sessionId: { value: 'parent-session' },
                custom: { value: 'keep-me' },
            })
        );

        const runContext = createAgentRunContext({
            sessionId: 'child-session',
            parentContext,
        });
        const baggage = propagation.getBaggage(runContext.telemetryContext);

        expect(getHostRuntimeContextFromBaggage(runContext.telemetryContext)).toBeUndefined();
        expect(baggage?.getEntry('hostRuntime.ids.runId')).toBeUndefined();
        expect(baggage?.getEntry('runId')).toBeUndefined();
        expect(baggage?.getEntry('custom')?.value).toBe('keep-me');
        expect(baggage?.getEntry('sessionId')?.value).toBe('child-session');
    });
});
