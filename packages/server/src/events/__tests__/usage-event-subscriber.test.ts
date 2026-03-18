import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEventBus, type Database } from '@dexto/core';
import { UsageEventSubscriber } from '../usage-event-subscriber.js';

function createInMemoryDatabase(): Database {
    const store = new Map<string, unknown>();

    return {
        async get<T>(key: string): Promise<T | undefined> {
            return store.get(key) as T | undefined;
        },
        async set<T>(key: string, value: T): Promise<void> {
            store.set(key, value);
        },
        async delete(key: string): Promise<void> {
            store.delete(key);
        },
        async list(prefix: string): Promise<string[]> {
            return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
        },
        async append<T>(key: string, item: T): Promise<void> {
            const current = (store.get(key) as T[] | undefined) ?? [];
            store.set(key, [...current, item]);
        },
        async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
            const current = (store.get(key) as T[] | undefined) ?? [];
            return current.slice(start, start + count);
        },
        async connect(): Promise<void> {},
        async disconnect(): Promise<void> {},
        isConnected(): boolean {
            return true;
        },
        getStoreType(): string {
            return 'memory';
        },
    };
}

describe('UsageEventSubscriber', () => {
    const mockFetch = vi.fn();
    let agentEventBus: AgentEventBus;
    let database: Database;
    let subscriber: UsageEventSubscriber;

    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
        } as Response);
        agentEventBus = new AgentEventBus();
        database = createInMemoryDatabase();
        subscriber = new UsageEventSubscriber({
            database,
            targetUrl: 'https://example.com/api/cloud-agents/sbx_test/usage/events:batch',
            authToken: 'dxt_test',
            runtimeId: 'rt_1',
            runId: 'run_1',
            fetchFn: mockFetch as typeof fetch,
            flushIntervalMs: 1000,
            batchSize: 10,
        });
    });

    afterEach(() => {
        subscriber.cleanup();
        vi.resetAllMocks();
    });

    it('persists and delivers usage events for final llm responses', async () => {
        subscriber.subscribe(agentEventBus);

        agentEventBus.emit('llm:response', {
            sessionId: 'session-1',
            content: 'Hello',
            messageId: 'msg-1',
            usageScopeId: 'cloud-agent-1',
            provider: 'openai',
            model: 'gpt-5',
            tokenUsage: {
                inputTokens: 10,
                outputTokens: 5,
                reasoningTokens: 2,
                cacheReadTokens: 1,
                cacheWriteTokens: 0,
                totalTokens: 18,
            },
            estimatedCost: 0.0123,
        });

        await vi.waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'https://example.com/api/cloud-agents/sbx_test/usage/events:batch',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer dxt_test',
                    'Content-Type': 'application/json',
                }),
            })
        );

        const request = mockFetch.mock.calls[0]?.[1];
        expect(request).toBeDefined();
        const parsedBody = JSON.parse(String(request?.body));
        expect(parsedBody).toEqual({
            events: [
                expect.objectContaining({
                    eventId: 'usage:cloud-agent-1:msg-1',
                    sessionId: 'session-1',
                    messageId: 'msg-1',
                    usageScopeId: 'cloud-agent-1',
                    provider: 'openai',
                    model: 'gpt-5',
                    estimatedCostUsd: 0.0123,
                    costBreakdownUsd: expect.objectContaining({
                        inputUsd: expect.any(Number),
                        outputUsd: expect.any(Number),
                        reasoningUsd: expect.any(Number),
                        cacheReadUsd: expect.any(Number),
                        cacheWriteUsd: expect.any(Number),
                        totalUsd: expect.any(Number),
                    }),
                    runtimeId: 'rt_1',
                    runId: 'run_1',
                    tokenUsage: {
                        inputTokens: 10,
                        outputTokens: 5,
                        reasoningTokens: 2,
                        cacheReadTokens: 1,
                        cacheWriteTokens: 0,
                        totalTokens: 18,
                    },
                }),
            ],
        });

        expect(await database.list('usage-outbox:')).toEqual([]);
    });

    it('skips llm responses without scoped usage metadata', async () => {
        subscriber.subscribe(agentEventBus);

        agentEventBus.emit('llm:response', {
            sessionId: 'session-1',
            content: 'Hello',
            tokenUsage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        });

        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(mockFetch).not.toHaveBeenCalled();
        expect(await database.list('usage-outbox:')).toEqual([]);
    });

    it('keeps pending events in the outbox when delivery fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
        } as Response);

        subscriber.subscribe(agentEventBus);

        agentEventBus.emit('llm:response', {
            sessionId: 'session-1',
            content: 'Hello',
            messageId: 'msg-1',
            usageScopeId: 'cloud-agent-1',
            tokenUsage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        });

        await vi.waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        expect(await database.list('usage-outbox:')).toEqual([
            'usage-outbox:usage:cloud-agent-1:msg-1',
        ]);
    });
});
