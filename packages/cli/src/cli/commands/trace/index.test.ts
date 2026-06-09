import { describe, expect, it } from 'vitest';
import { formatSpanList, formatTraceList, formatTraceSummary } from './format.js';

describe('formatTraceSummary', () => {
    it('formats readable run trace output', () => {
        const output = formatTraceSummary('run_123', {
            events: [{ eventId: 'event_1', name: 'llm.first_token' }],
            spans: [
                {
                    durationMs: 42,
                    errorMessage: null,
                    name: 'llm.stream',
                    startedAt: '2026-01-02T10:00:00.000Z',
                    status: 'completed',
                },
            ],
        } as Parameters<typeof formatTraceSummary>[1]);

        expect(output).toContain('Run trace run_123');
        expect(output).toContain('Spans: 1  Events: 1');
        expect(output).toContain('completed');
        expect(output).toContain('42ms');
        expect(output).toContain('llm.stream');
    });

    it('formats readable trace list output', () => {
        const output = formatTraceList([
            {
                durationMs: 4242,
                errorCount: 1,
                eventCount: 2,
                firstSpanStartedAt: '2026-01-02T10:00:00.000Z',
                lastSpanStartedAt: '2026-01-02T10:00:04.000Z',
                runId: 'run_123',
                sessionId: 'session_123',
                spanCount: 7,
                spanNames: ['llm.stream', 'turn.run_model_step'],
                status: 'failed',
            },
        ]);

        expect(output).toContain('Recent run traces');
        expect(output).toContain('run_123');
        expect(output).toContain('session_123');
        expect(output).toContain('errors=1');
        expect(output).toContain('llm.stream');
    });

    it('formats readable span list output', () => {
        const output = formatSpanList('run_123', [
            {
                durationMs: 42,
                errorMessage: null,
                name: 'llm.stream',
                spanId: 'span_123',
                startedAt: '2026-01-02T10:00:00.000Z',
                status: 'completed',
                traceId: 'trace_123',
            },
        ] as Parameters<typeof formatSpanList>[1]);

        expect(output).toContain('Spans for run run_123');
        expect(output).toContain('Count: 1');
        expect(output).toContain('completed');
        expect(output).toContain('42ms');
        expect(output).toContain('span_123');
    });
});
