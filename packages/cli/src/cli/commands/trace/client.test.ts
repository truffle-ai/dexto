import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDextoApiKey = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock('../../auth/service.js', () => ({
    getDextoApiKey: mockGetDextoApiKey,
}));

describe('createTraceClient', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        mockGetDextoApiKey.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        delete process.env.DEXTO_PLATFORM_URL;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('fetches a run trace with the stored Dexto API key', async () => {
        mockGetDextoApiKey.mockResolvedValue('dxt_trace_key');
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    trace: {
                        events: [],
                        spans: [
                            {
                                attributes: { provider: 'openai' },
                                durationMs: 123,
                                endedAt: '2026-01-02T10:00:01.123Z',
                                errorCode: null,
                                errorMessage: null,
                                id: 'run-span-1',
                                name: 'llm.stream',
                                parentSpanId: null,
                                runAttemptId: null,
                                runId: 'run_123',
                                sessionId: 'session_123',
                                spanId: 'span_123',
                                startedAt: '2026-01-02T10:00:01.000Z',
                                status: 'completed',
                                traceId: 'trace_123',
                            },
                        ],
                    },
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                }
            )
        );

        const { createTraceClient } = await import('./client.js');
        const trace = await createTraceClient({
            platformUrl: 'https://preview.example.com/',
        }).fetchRunTrace('run_123');

        expect(trace.spans).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://preview.example.com/api/runs/run_123/trace',
            expect.objectContaining({
                headers: {
                    Authorization: 'Bearer dxt_trace_key',
                },
                method: 'GET',
            })
        );
    });

    it('applies a default timeout to trace requests', async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        mockGetDextoApiKey.mockResolvedValue('dxt_trace_key');
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    traces: [],
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                }
            )
        );

        const { createTraceClient } = await import('./client.js');
        await createTraceClient({
            platformUrl: 'https://preview.example.com/',
        }).listRunTraces();

        expect(timeoutSpy).toHaveBeenCalledWith(10_000);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://preview.example.com/api/runs/traces',
            expect.objectContaining({
                signal: expect.objectContaining({
                    aborted: false,
                }),
            })
        );
    });

    it('lists run trace summaries with filters', async () => {
        mockGetDextoApiKey.mockResolvedValue('dxt_trace_key');
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    traces: [
                        {
                            durationMs: 3456,
                            errorCount: 1,
                            eventCount: 2,
                            firstSpanStartedAt: '2026-01-02T10:00:00.000Z',
                            lastSpanStartedAt: '2026-01-02T10:00:03.000Z',
                            runId: 'run_123',
                            sessionId: 'session_123',
                            spanCount: 7,
                            spanNames: ['llm.stream'],
                            status: 'failed',
                        },
                    ],
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                }
            )
        );

        const { createTraceClient } = await import('./client.js');
        const traces = await createTraceClient({
            platformUrl: 'https://preview.example.com/',
        }).listRunTraces({
            limit: 5,
            period: '3h',
            sessionId: 'session_123',
            status: 'failed',
        });

        expect(traces).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://preview.example.com/api/runs/traces?limit=5&period=3h&sessionId=session_123&status=failed',
            expect.objectContaining({
                headers: {
                    Authorization: 'Bearer dxt_trace_key',
                },
                method: 'GET',
            })
        );
    });

    it('lists run spans with filters', async () => {
        mockGetDextoApiKey.mockResolvedValue('dxt_trace_key');
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    spans: [
                        {
                            attributes: { provider: 'openai' },
                            durationMs: 123,
                            endedAt: '2026-01-02T10:00:01.123Z',
                            errorCode: null,
                            errorMessage: null,
                            id: 'run-span-1',
                            name: 'llm.stream',
                            parentSpanId: null,
                            runAttemptId: null,
                            runId: 'run_123',
                            sessionId: 'session_123',
                            spanId: 'span_123',
                            startedAt: '2026-01-02T10:00:01.000Z',
                            status: 'completed',
                            traceId: 'trace_123',
                        },
                    ],
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                }
            )
        );

        const { createTraceClient } = await import('./client.js');
        const spans = await createTraceClient({
            platformUrl: 'https://preview.example.com/',
        }).listRunSpans('run_123', {
            limit: 10,
            name: 'llm.stream',
            sort: 'duration',
            status: 'completed',
        });

        expect(spans).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://preview.example.com/api/runs/run_123/spans?limit=10&name=llm.stream&sort=duration&status=completed',
            expect.objectContaining({
                headers: {
                    Authorization: 'Bearer dxt_trace_key',
                },
                method: 'GET',
            })
        );
    });

    it('defaults trace reads to the hosted Cloudflare app', async () => {
        const { resolveTracePlatformUrl } = await import('./client.js');

        expect(resolveTracePlatformUrl()).toBe('https://dexto-cloudflare.rahul-630.workers.dev');
    });

    it('honors DEXTO_PLATFORM_URL for trace reads', async () => {
        vi.stubEnv('DEXTO_PLATFORM_URL', 'https://preview.example.com/');
        const { resolveTracePlatformUrl } = await import('./client.js');

        expect(resolveTracePlatformUrl()).toBe('https://preview.example.com');
    });

    it('requires a Dexto API key', async () => {
        mockGetDextoApiKey.mockResolvedValue(null);

        const { createTraceClient } = await import('./client.js');

        await expect(createTraceClient().fetchRunTrace('run_123')).rejects.toThrow(
            'Authentication required'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
