import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { APICallError } from 'ai';
import { trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { StreamProcessor } from './stream-processor.js';
import type { StreamProcessorConfig } from './stream-processor.js';
import type { ContextManager } from '../../context/manager.js';
import type { SessionEventBus } from '../../events/index.js';
import type { Logger } from '../../logger/v2/types.js';

/**
 * Creates a mock async generator that yields events
 */
function createMockStream(events: Array<Record<string, unknown>>) {
    return {
        fullStream: (async function* () {
            for (const event of events) {
                yield event;
            }
        })(),
    };
}

/**
 * Creates mock dependencies for StreamProcessor
 */
function createMocks() {
    const emittedEvents: Array<{ name: string; payload: unknown }> = [];

    const mockContextManager = {
        addAssistantMessage: vi.fn().mockResolvedValue(undefined),
        appendAssistantText: vi.fn().mockResolvedValue(undefined),
        updateAssistantMessage: vi.fn().mockResolvedValue(undefined),
        addToolCall: vi.fn().mockResolvedValue(undefined),
        addToolResult: vi.fn().mockResolvedValue(undefined),
        getHistory: vi.fn().mockResolvedValue([{ id: 'msg-1', role: 'assistant', content: '' }]),
    } as unknown as ContextManager;

    const mockEventBus = {
        emit: vi.fn((name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
        }),
    } as unknown as SessionEventBus;

    const mockLogger = {
        createChild: vi.fn().mockReturnThis(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as Logger;

    const mockAbortController = new AbortController();

    const config: StreamProcessorConfig = {
        provider: 'openai',
        model: 'gpt-4',
    };

    return {
        contextManager: mockContextManager,
        eventBus: mockEventBus,
        logger: mockLogger,
        abortController: mockAbortController,
        config,
        emittedEvents,
    };
}

describe('StreamProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Text Accumulation', () => {
        test('marks streamed assistant output draft first and complete on finish', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addAssistantMessage).toHaveBeenCalledWith('', [], {
                assistantOutput: { status: 'draft' },
            });
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    assistantOutput: { status: 'complete' },
                })
            );
        });

        test('accumulates text from multiple text-delta events', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                { type: 'text-delta', text: ' world' },
                { type: 'text-delta', text: '!' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.text).toBe('Hello world!');
        });

        test('returns accumulated text in result', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Test response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.text).toBe('Test response');
            expect(result.finishReason).toBe('stop');
        });

        test('includes accumulated text in llm:response event', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response content' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const responseEvent = mocks.emittedEvents.find((e) => e.name === 'llm:response');
            expect(responseEvent).toBeDefined();
            expect((responseEvent?.payload as { content: string }).content).toBe(
                'Response content'
            );
        });

        test('creates assistant message on first text-delta', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addAssistantMessage).toHaveBeenCalledWith('', [], {
                assistantOutput: { status: 'draft' },
            });
        });

        test('appends text to assistant message for each delta', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                { type: 'text-delta', text: ' world' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.appendAssistantText).toHaveBeenCalledTimes(2);
            expect(mocks.contextManager.appendAssistantText).toHaveBeenNthCalledWith(
                1,
                'msg-1',
                'Hello'
            );
            expect(mocks.contextManager.appendAssistantText).toHaveBeenNthCalledWith(
                2,
                'msg-1',
                ' world'
            );
        });
    });

    describe('Chunk Emission', () => {
        test('sets stream boundary timing attributes on the active span', async () => {
            const contextManager = new AsyncHooksContextManager().enable();
            const exporter = new InMemorySpanExporter();
            const provider = new BasicTracerProvider();
            provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
            provider.register({ contextManager });

            try {
                const mocks = createMocks();
                const processor = new StreamProcessor(
                    mocks.contextManager,
                    mocks.eventBus,
                    mocks.abortController.signal,
                    mocks.config,
                    mocks.logger,
                    true
                );

                const events = [
                    { type: 'text-delta', text: 'Hello' },
                    { type: 'reasoning-delta', text: ' thinking' },
                    { type: 'text-delta', text: ' world' },
                    { type: 'reasoning-delta', text: ' done' },
                    {
                        type: 'finish',
                        finishReason: 'stop',
                        totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                    },
                ];

                await trace.getTracer('test').startActiveSpan('llm.stream', async (span) => {
                    try {
                        await processor.process(() => createMockStream(events) as never);
                    } finally {
                        span.end();
                    }
                });

                const span = exporter
                    .getFinishedSpans()
                    .find((entry) => entry.name === 'llm.stream');

                expect(span?.attributes).toEqual(
                    expect.objectContaining({
                        'llm.stream.finish_event_received_ms': expect.any(Number),
                        'llm.stream.finish_after_last_delta_ms': expect.any(Number),
                        'llm.stream.finish_after_last_reasoning_delta_ms': expect.any(Number),
                        'llm.stream.finish_after_last_text_delta_ms': expect.any(Number),
                        'llm.stream.first_reasoning_delta_received_ms': expect.any(Number),
                        'llm.stream.first_text_delta_received_ms': expect.any(Number),
                        'llm.stream.full_stream_iterator_completed_ms': expect.any(Number),
                        'llm.stream.last_delta_kind': 'reasoning',
                        'llm.stream.last_delta_received_ms': expect.any(Number),
                        'llm.stream.last_reasoning_delta_emitted_ms': expect.any(Number),
                        'llm.stream.last_reasoning_delta_received_ms': expect.any(Number),
                        'llm.stream.last_text_delta_emitted_ms': expect.any(Number),
                        'llm.stream.last_text_delta_received_ms': expect.any(Number),
                        'llm.stream.llm_response_emit_started_ms': expect.any(Number),
                        'llm.stream.llm_response_emitted_ms': expect.any(Number),
                        'llm.stream.metadata_persist_finished_ms': expect.any(Number),
                        'llm.stream.metadata_persist_started_ms': expect.any(Number),
                        'llm.stream.reasoning_delta_count': 2,
                        'llm.stream.text_delta_count': 2,
                    })
                );
            } finally {
                await provider.shutdown();
                contextManager.disable();
                trace.disable();
            }
        });

        test('streaming=true: emits llm:chunk for each text-delta', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true // streaming = true
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                { type: 'text-delta', text: ' world' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const chunkEvents = mocks.emittedEvents.filter((e) => e.name === 'llm:chunk');
            expect(chunkEvents).toHaveLength(2);
            expect((chunkEvents[0]?.payload as { content: string }).content).toBe('Hello');
            expect((chunkEvents[1]?.payload as { content: string }).content).toBe(' world');
        });

        test('streaming=false: does NOT emit llm:chunk events', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                false // streaming = false
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                { type: 'text-delta', text: ' world' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const chunkEvents = mocks.emittedEvents.filter((e) => e.name === 'llm:chunk');
            expect(chunkEvents).toHaveLength(0);
        });

        test('still accumulates text when streaming=false', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                false // streaming = false
            );

            const events = [
                { type: 'text-delta', text: 'Hello' },
                { type: 'text-delta', text: ' world' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.text).toBe('Hello world');
        });
    });

    describe('Reasoning Delta Handling', () => {
        test('accumulates reasoning-delta separately from text', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'reasoning-delta', text: 'Thinking...' },
                { type: 'text-delta', text: 'Answer' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            // Text should only contain non-reasoning content
            expect(result.text).toBe('Answer');
        });

        test('includes reasoning in llm:response event', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'reasoning-delta', text: 'Let me think...' },
                { type: 'reasoning-delta', text: ' about this.' },
                { type: 'text-delta', text: 'Here is my answer' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const responseEvent = mocks.emittedEvents.find((e) => e.name === 'llm:response');
            expect(responseEvent).toBeDefined();
            expect((responseEvent?.payload as { reasoning: string }).reasoning).toBe(
                'Let me think... about this.'
            );
        });

        test('emits reasoning chunks when streaming=true', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'reasoning-delta', text: 'Thinking...' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const chunkEvents = mocks.emittedEvents.filter((e) => e.name === 'llm:chunk');
            expect(chunkEvents).toHaveLength(1);
            expect((chunkEvents[0]?.payload as { chunkType: string }).chunkType).toBe('reasoning');
        });
    });

    describe('Tool Call Handling', () => {
        test('creates assistant message if not exists', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addAssistantMessage).toHaveBeenCalled();
        });

        test('records tool call to context', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith('msg-1', {
                id: 'call-1',
                type: 'function',
                function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg: 'value' }),
                },
            });
        });

        test('does not persist providerMetadata for OpenAI tool calls (avoids OpenAI Responses replay issues)', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                    providerMetadata: { openai: { some: 'metadata' } },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith('msg-1', {
                id: 'call-1',
                type: 'function',
                function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg: 'value' }),
                },
            });
        });

        test('persists providerMetadata for Google tool calls (required for round-tripping thought signatures)', async () => {
            const mocks = createMocks();
            const config: StreamProcessorConfig = { ...mocks.config, provider: 'google' };
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                    providerMetadata: { google: { thoughtSignature: 'sig-1' } },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith('msg-1', {
                id: 'call-1',
                type: 'function',
                function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg: 'value' }),
                },
                providerOptions: { google: { thoughtSignature: 'sig-1' } },
            });
            expect(result.toolCalls).toEqual([
                {
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                },
            ]);
        });

        test('persists tool call to context without emitting UI tool-call event', async () => {
            // TurnExecutor emits llm:tool-call after preparation so the UI receives
            // normalized presentation metadata before approval handling starts.
            // This test verifies StreamProcessor still persists tool calls to context.
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    input: { arg: 'value' },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify tool call was persisted to context
            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith(
                expect.any(String), // assistant message ID
                {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        arguments: JSON.stringify({ arg: 'value' }),
                    },
                }
            );
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    assistantOutput: { status: 'complete' },
                })
            );
        });
    });

    describe('Finish Event Handling', () => {
        test('captures finishReason', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Done' },
                {
                    type: 'finish',
                    finishReason: 'length',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.finishReason).toBe('length');
        });

        test('marks assistant output stopped on stream abort', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [{ type: 'text-delta', text: 'Partial response' }, { type: 'abort' }];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    assistantOutput: { status: 'stopped', reason: 'cancelled' },
                })
            );
        });

        test('marks assistant output stopped when stream fails after partial text', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Partial response' },
                { type: 'error', error: new Error('provider failed') },
            ];

            await expect(
                processor.process(() => createMockStream(events) as never)
            ).rejects.toThrow('provider failed');
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    assistantOutput: { status: 'stopped', reason: 'failed' },
                })
            );
        });

        test('captures token usage including reasoning tokens', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                        reasoningTokens: 20,
                    },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.usage).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                reasoningTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });
        });

        test('treats null usage fields from providers as missing', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: {
                        inputTokens: null,
                        outputTokens: null,
                        totalTokens: null,
                        reasoningTokens: null,
                        cachedInputTokens: null,
                        inputTokenDetails: {
                            noCacheTokens: null,
                            cacheReadTokens: null,
                            cacheWriteTokens: null,
                        },
                    },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.usage).toEqual({
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });
        });

        test('treats NaN usage fields from providers as missing', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: {
                        inputTokens: Number.NaN,
                        outputTokens: 6,
                        totalTokens: 4560,
                        reasoningTokens: Number.NaN,
                        cachedInputTokens: Number.NaN,
                        inputTokenDetails: {
                            noCacheTokens: Number.NaN,
                            cacheReadTokens: Number.NaN,
                            cacheWriteTokens: 0,
                        },
                    },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.usage).toEqual({
                inputTokens: 0,
                outputTokens: 6,
                totalTokens: 4560,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            });
        });

        test('subtracts cached input tokens from inputTokens when cachedInputTokens is present', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: {
                        inputTokens: 1000,
                        outputTokens: 50,
                        totalTokens: 1050,
                        cachedInputTokens: 900,
                    },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.usage).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 1050,
                cacheReadTokens: 900,
                cacheWriteTokens: 0,
            });
        });

        test('avoids double-counting cache write tokens when only cachedInputTokens are present', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    providerMetadata: {
                        anthropic: {
                            cacheCreationInputTokens: 100,
                            cacheReadInputTokens: 900,
                        },
                    },
                    totalUsage: {
                        inputTokens: 1100,
                        outputTokens: 50,
                        totalTokens: 1150,
                        cachedInputTokens: 900,
                    },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.usage).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 1150,
                cacheReadTokens: 900,
                cacheWriteTokens: 100,
            });
        });

        test('updates assistant message with usage', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    tokenUsage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    estimatedCost: expect.any(Number),
                    pricingStatus: 'estimated',
                })
            );
        });

        test('persists reasoning text to assistant message', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'reasoning-delta', text: 'Let me think...' },
                { type: 'reasoning-delta', text: ' about this carefully.' },
                { type: 'text-delta', text: 'Here is my answer' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify reasoning is persisted to the assistant message
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    reasoning: 'Let me think... about this carefully.',
                })
            );
        });

        test('persists reasoning metadata (providerMetadata) to assistant message', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const providerMetadata = { openai: { itemId: 'item-123' } };
            const events = [
                { type: 'reasoning-delta', text: 'Thinking...', providerMetadata },
                { type: 'text-delta', text: 'Answer' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify reasoning metadata is persisted
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    reasoning: 'Thinking...',
                    reasoningMetadata: providerMetadata,
                })
            );
        });

        test('accumulates OpenRouter reasoning_details across multiple reasoning-delta events', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const providerMetadataA = {
                openrouter: { reasoning_details: [{ type: 'reasoning.text', text: 'A' }] },
            };
            const providerMetadataB = {
                openrouter: { reasoning_details: [{ type: 'reasoning.text', text: 'B' }] },
            };

            const events = [
                { type: 'reasoning-delta', text: 'A', providerMetadata: providerMetadataA },
                { type: 'reasoning-delta', text: 'B', providerMetadata: providerMetadataB },
                { type: 'text-delta', text: 'Answer' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    reasoning: 'AB',
                    reasoningMetadata: {
                        openrouter: {
                            reasoning_details: [
                                { type: 'reasoning.text', text: 'A' },
                                { type: 'reasoning.text', text: 'B' },
                            ],
                        },
                    },
                })
            );
        });

        test('emits llm:response with content, usage, provider, model', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Final response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const responseEvent = mocks.emittedEvents.find((e) => e.name === 'llm:response');
            expect(responseEvent).toBeDefined();
            expect(responseEvent?.payload).toMatchObject({
                content: 'Final response',
                messageId: 'msg-1',
                provider: 'openai',
                model: 'gpt-4',
                costBreakdown: {
                    inputUsd: expect.any(Number),
                    outputUsd: expect.any(Number),
                    totalUsd: expect.any(Number),
                },
                pricingStatus: 'estimated',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });
            expect(
                (responseEvent?.payload as { estimatedCost?: number } | undefined)?.estimatedCost
            ).toBeGreaterThan(0);
        });

        test('tags response usage with configured usage scope id', async () => {
            const mocks = createMocks();
            mocks.config.usageScopeId = 'cloud-agent-1';
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Scoped response' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const responseEvent = mocks.emittedEvents.find((e) => e.name === 'llm:response');
            expect(responseEvent?.payload).toMatchObject({
                usageScopeId: 'cloud-agent-1',
            });
            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    usageScopeId: 'cloud-agent-1',
                })
            );
        });
    });

    describe('Error Event Handling', () => {
        test('throws Error objects from fatal stream events and emits llm:error', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const testError = new Error('Test error');
            const events = [{ type: 'error', error: testError }];

            await expect(
                processor.process(() => createMockStream(events) as never)
            ).rejects.toMatchObject({
                code: 'llm_generation_failed',
                message: 'Test error',
                context: expect.objectContaining({
                    model: 'gpt-4',
                    provider: 'openai',
                }),
            });
            expect(mocks.emittedEvents.find((e) => e.name === 'llm:error')).toMatchObject({
                name: 'llm:error',
                payload: {
                    error: {
                        code: 'llm_generation_failed',
                        message: 'Test error',
                    },
                    context: 'StreamProcessor',
                    recoverable: false,
                },
            });
        });

        test('wraps non-Error fatal stream events before throwing and emits llm:error', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [{ type: 'error', error: 'String error message' }];

            await expect(
                processor.process(() => createMockStream(events) as never)
            ).rejects.toMatchObject({
                message: 'String error message',
            });
            const errorEvents = mocks.emittedEvents.filter((e) => e.name === 'llm:error');
            expect(errorEvents).toHaveLength(1);
            expect(errorEvents[0]).toMatchObject({
                name: 'llm:error',
                payload: {
                    context: 'StreamProcessor',
                    recoverable: false,
                },
            });
        });

        test('classifies OpenAI-compatible schema string stream errors', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            await expect(
                processor.process(
                    () =>
                        createMockStream([
                            {
                                type: 'error',
                                error: "Invalid schema for function 'dexto_apps': schema must have type 'object'",
                            },
                        ]) as never
                )
            ).rejects.toMatchObject({
                code: 'llm_request_invalid_schema',
                message: expect.stringContaining("Invalid schema for function 'dexto_apps'"),
            });

            const errorEvents = mocks.emittedEvents.filter((e) => e.name === 'llm:error');
            expect(errorEvents).toHaveLength(1);
            expect(errorEvents[0]).toMatchObject({
                payload: {
                    error: {
                        code: 'llm_request_invalid_schema',
                    },
                },
            });
        });

        test('extracts OpenRouter provider metadata from API stream errors', async () => {
            const mocks = createMocks();
            mocks.config.provider = 'openrouter';
            mocks.config.model = 'openai/gpt-5.4-mini';
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );
            const responseBody = JSON.stringify({
                error: {
                    code: 400,
                    message: 'Provider returned error',
                    metadata: {
                        provider_name: 'OpenAI',
                        raw: {
                            error: {
                                code: 'invalid_function_parameters',
                                message:
                                    "Invalid schema for function 'dexto_apps': schema must have type 'object'",
                                param: 'tools[23].parameters',
                            },
                        },
                        previous_errors: [{}],
                    },
                },
            });
            const apiError = new APICallError({
                message: 'Bad Request',
                statusCode: 400,
                responseHeaders: {},
                responseBody,
                url: 'https://openrouter.ai/api/v1/chat/completions',
                requestBodyValues: {},
                isRetryable: false,
            });

            await expect(
                processor.process(
                    () => createMockStream([{ type: 'error', error: apiError }]) as never
                )
            ).rejects.toMatchObject({
                code: 'llm_request_invalid_schema',
                message: expect.stringContaining("Invalid schema for function 'dexto_apps'"),
            });
            expect(mocks.emittedEvents.find((e) => e.name === 'llm:error')).toMatchObject({
                payload: {
                    details: {
                        model: 'openai/gpt-5.4-mini',
                        openRouterProviderName: 'OpenAI',
                        openRouterProviderRawCode: 'invalid_function_parameters',
                        openRouterProviderRawMessage:
                            "Invalid schema for function 'dexto_apps': schema must have type 'object'",
                        openRouterProviderRawParam: 'tools[23].parameters',
                        provider: 'openrouter',
                        statusCode: 400,
                    },
                },
            });
        });

        test('persists failed tool results before throwing fatal stream errors', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const testError = new Error('Test error');
            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'bash',
                    input: { command: 'echo hi' },
                },
                { type: 'error', error: testError },
            ];

            await expect(
                processor.process(() => createMockStream(events) as never)
            ).rejects.toMatchObject({
                code: 'llm_generation_failed',
                message: 'Test error',
                context: expect.objectContaining({
                    model: 'gpt-4',
                    provider: 'openai',
                }),
            });

            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith(expect.any(String), {
                id: 'call-1',
                type: 'function',
                function: {
                    name: 'bash',
                    arguments: JSON.stringify({ command: 'echo hi' }),
                },
            });
            expect(mocks.contextManager.addToolResult).toHaveBeenCalledWith(
                'call-1',
                'bash',
                expect.objectContaining({
                    content: [{ type: 'text', text: 'Error: Test error' }],
                    meta: expect.objectContaining({
                        success: false,
                    }),
                }),
                undefined
            );
            expect(mocks.emittedEvents.find((e) => e.name === 'llm:error')).toMatchObject({
                name: 'llm:error',
                payload: {
                    error: {
                        code: 'llm_generation_failed',
                        message: 'Test error',
                    },
                    context: 'StreamProcessor',
                    recoverable: false,
                },
            });

            const toolResultEvent = mocks.emittedEvents.find((e) => e.name === 'llm:tool-result');
            expect(toolResultEvent?.payload).toMatchObject({
                toolName: 'bash',
                callId: 'call-1',
                success: false,
                error: 'Test error',
            });
        });

        test('persists failed tool results for every pending sibling before fatal stream errors', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const testError = new Error('Model stream failed');
            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'read_file',
                    input: { path: 'a.txt' },
                },
                {
                    type: 'tool-call',
                    toolCallId: 'call-2',
                    toolName: 'write_file',
                    input: { path: 'b.txt', content: 'hello' },
                },
                { type: 'error', error: testError },
            ];

            await expect(
                processor.process(() => createMockStream(events) as never)
            ).rejects.toMatchObject({
                code: 'llm_generation_failed',
                message: 'Model stream failed',
                context: expect.objectContaining({
                    model: 'gpt-4',
                    provider: 'openai',
                }),
            });

            expect(mocks.contextManager.addToolResult).toHaveBeenCalledTimes(2);
            expect(mocks.contextManager.addToolResult).toHaveBeenNthCalledWith(
                1,
                'call-1',
                'read_file',
                expect.objectContaining({
                    content: [{ type: 'text', text: 'Error: Model stream failed' }],
                    meta: expect.objectContaining({
                        toolCallId: 'call-1',
                        success: false,
                    }),
                }),
                undefined
            );
            expect(mocks.contextManager.addToolResult).toHaveBeenNthCalledWith(
                2,
                'call-2',
                'write_file',
                expect.objectContaining({
                    content: [{ type: 'text', text: 'Error: Model stream failed' }],
                    meta: expect.objectContaining({
                        toolCallId: 'call-2',
                        success: false,
                    }),
                }),
                undefined
            );

            const toolResultEvents = mocks.emittedEvents.filter(
                (event) => event.name === 'llm:tool-result'
            );
            expect(toolResultEvents.map((event) => event.payload)).toMatchObject([
                {
                    toolName: 'read_file',
                    callId: 'call-1',
                    success: false,
                    error: 'Model stream failed',
                },
                {
                    toolName: 'write_file',
                    callId: 'call-2',
                    success: false,
                    error: 'Model stream failed',
                },
            ]);
        });
    });

    describe('Abort Signal', () => {
        test('completes with accumulated content when abort signal fires mid-stream', async () => {
            const mocks = createMocks();

            // Create a stream that will yield events then abort
            const slowStream = {
                fullStream: (async function* () {
                    yield { type: 'text-delta', text: 'Hello' };
                    // Abort signal fires but stream continues (SDK behavior)
                    mocks.abortController.abort();
                    yield { type: 'text-delta', text: ' world' };
                })(),
            };

            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            // Resolves with accumulated content
            const result = await processor.process(() => slowStream as never);
            expect(result.text).toBe('Hello world');
        });

        test('emits partial response with cancelled finish reason when stream emits abort event', async () => {
            const mocks = createMocks();

            // Create a stream that emits an abort event (SDK-level cancellation)
            const abortingStream = {
                fullStream: (async function* () {
                    yield { type: 'text-delta', text: 'Hello' };
                    // Stream itself signals abort (e.g., network disconnect, timeout)
                    yield { type: 'abort' };
                })(),
            };

            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            // Emits partial response with cancelled finish reason
            const result = await processor.process(() => abortingStream as never);
            expect(result.text).toBe('Hello');
            expect(result.finishReason).toBe('cancelled');
        });

        test('persists assistant usage metadata before emitting cancelled response', async () => {
            const mocks = createMocks();

            const abortingStream = {
                fullStream: (async function* () {
                    yield { type: 'text-delta', text: 'Hello' };
                    yield {
                        type: 'finish-step',
                        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
                    };
                    yield { type: 'abort' };
                })(),
            };

            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            await processor.process(() => abortingStream as never);

            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    tokenUsage: {
                        inputTokens: 12,
                        outputTokens: 4,
                        totalTokens: 16,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    estimatedCost: expect.any(Number),
                    pricingStatus: 'estimated',
                })
            );

            const responseEvent = mocks.emittedEvents.find((e) => e.name === 'llm:response');
            expect(responseEvent?.payload).toMatchObject({
                finishReason: 'cancelled',
                costBreakdown: {
                    inputUsd: expect.any(Number),
                    outputUsd: expect.any(Number),
                    totalUsd: expect.any(Number),
                },
                pricingStatus: 'estimated',
                tokenUsage: {
                    inputTokens: 12,
                    outputTokens: 4,
                    totalTokens: 16,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            });
            expect(
                (responseEvent?.payload as { estimatedCost?: number } | undefined)?.estimatedCost
            ).toBeGreaterThan(0);
        });

        test('persists cancelled tool results for every pending sibling tool call', async () => {
            const mocks = createMocks();
            const abortingStream = {
                fullStream: (async function* () {
                    yield {
                        type: 'tool-call',
                        toolCallId: 'call-done',
                        toolName: 'read_file',
                        input: { path: 'a.txt' },
                    };
                    yield {
                        type: 'tool-call',
                        toolCallId: 'call-pending',
                        toolName: 'write_file',
                        input: { path: 'b.txt', content: 'hello' },
                    };
                    yield { type: 'abort' };
                })(),
            };

            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            await processor.process(() => abortingStream as never);

            expect(mocks.contextManager.addToolResult).toHaveBeenCalledTimes(2);
            expect(mocks.contextManager.addToolResult).toHaveBeenNthCalledWith(
                1,
                'call-done',
                'read_file',
                expect.objectContaining({
                    content: [{ type: 'text', text: 'Cancelled by user' }],
                    meta: expect.objectContaining({
                        toolCallId: 'call-done',
                        success: false,
                    }),
                }),
                undefined
            );
            expect(mocks.contextManager.addToolResult).toHaveBeenNthCalledWith(
                2,
                'call-pending',
                'write_file',
                expect.objectContaining({
                    content: [{ type: 'text', text: 'Cancelled by user' }],
                    meta: expect.objectContaining({
                        toolCallId: 'call-pending',
                        success: false,
                    }),
                }),
                undefined
            );

            const toolResultEvents = mocks.emittedEvents.filter(
                (event) => event.name === 'llm:tool-result'
            );
            expect(toolResultEvents.map((event) => event.payload)).toMatchObject([
                {
                    toolName: 'read_file',
                    callId: 'call-done',
                    success: false,
                    error: 'Cancelled by user',
                },
                {
                    toolName: 'write_file',
                    callId: 'call-pending',
                    success: false,
                    error: 'Cancelled by user',
                },
            ]);
        });
    });

    describe('Edge Cases', () => {
        test('handles empty stream (only finish event)', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.text).toBe('');
            expect(result.finishReason).toBe('stop');
        });

        test('handles multiple tool calls in sequence', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'tool_a',
                    input: { a: 1 },
                },
                {
                    type: 'tool-call',
                    toolCallId: 'call-2',
                    toolName: 'tool_b',
                    input: { b: 2 },
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            // Verify both tool calls were persisted to context
            expect(mocks.contextManager.addToolCall).toHaveBeenCalledTimes(2);
            expect(result.toolCalls).toEqual([
                {
                    toolCallId: 'call-1',
                    toolName: 'tool_a',
                    input: { a: 1 },
                },
                {
                    toolCallId: 'call-2',
                    toolName: 'tool_b',
                    input: { b: 2 },
                },
            ]);
        });

        test('handles interleaved text and tool calls', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                { type: 'text-delta', text: 'Let me check ' },
                {
                    type: 'tool-call',
                    toolCallId: 'call-1',
                    toolName: 'lookup',
                    input: {},
                },
                { type: 'text-delta', text: 'the answer is 42' },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            const result = await processor.process(() => createMockStream(events) as never);

            expect(result.text).toBe('Let me check the answer is 42');
        });
    });
});
