import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamProcessor } from './stream-processor.js';
import type { StreamProcessorConfig } from './stream-processor.js';
import type { ContextManager } from '../../context/manager.js';
import type { SessionEventBus } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

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

    const mockResourceManager = {
        getBlobStore: vi.fn().mockReturnValue({}),
    } as unknown as ResourceManager;

    const mockLogger = {
        createChild: vi.fn().mockReturnThis(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as IDextoLogger;

    const mockAbortController = new AbortController();

    const config: StreamProcessorConfig = {
        provider: 'openai',
        model: 'gpt-4',
    };

    return {
        contextManager: mockContextManager,
        eventBus: mockEventBus,
        resourceManager: mockResourceManager,
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
        test('accumulates text from multiple text-delta events', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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

            expect(mocks.contextManager.addAssistantMessage).toHaveBeenCalledWith('', [], {});
        });

        test('appends text to assistant message for each delta', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
        test('streaming=true: emits llm:chunk for each text-delta', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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

            await processor.process(() => createMockStream(events) as never);

            expect(mocks.contextManager.addToolCall).toHaveBeenCalledWith('msg-1', {
                id: 'call-1',
                type: 'function',
                function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg: 'value' }),
                },
                providerOptions: { google: { thoughtSignature: 'sig-1' } },
            });
        });

        test('persists tool call to context (llm:tool-call emitted by ToolManager)', async () => {
            // NOTE: llm:tool-call is now emitted from ToolManager.executeTool() instead of StreamProcessor.
            // This ensures correct event ordering - llm:tool-call arrives before approval:request.
            // This test verifies StreamProcessor still persists tool calls to context.
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
        });
    });

    describe('Tool Result Handling', () => {
        test('persists sanitized and truncated tool result via contextManager', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    output: { result: 'raw output' },
                },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify addToolResult was called with sanitized result containing meta.success
            expect(mocks.contextManager.addToolResult).toHaveBeenCalledWith(
                'call-1',
                'test_tool',
                expect.objectContaining({
                    content: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
                    meta: expect.objectContaining({
                        success: true, // Success status is in sanitizedResult.meta
                    }),
                }),
                undefined // No approval metadata for this call
            );
        });

        test('emits llm:tool-result with success=true', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'test_tool',
                    output: { result: 'success' },
                },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            const toolResultEvent = mocks.emittedEvents.find((e) => e.name === 'llm:tool-result');
            expect(toolResultEvent).toBeDefined();
            expect((toolResultEvent?.payload as { success: boolean }).success).toBe(true);
            expect((toolResultEvent?.payload as { toolName: string }).toolName).toBe('test_tool');
            expect((toolResultEvent?.payload as { callId: string }).callId).toBe('call-1');
        });

        test('stores tool result with success status for rehydration', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [
                {
                    type: 'tool-result',
                    toolCallId: 'call-rehydrate',
                    toolName: 'storage_tool',
                    output: { stored: true, id: 'doc-123' },
                },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify addToolResult is called with success in meta for storage/rehydration
            expect(mocks.contextManager.addToolResult).toHaveBeenCalledWith(
                'call-rehydrate',
                'storage_tool',
                expect.objectContaining({
                    meta: expect.objectContaining({
                        success: true, // Success status is in sanitizedResult.meta
                    }),
                }),
                undefined // No approval metadata for this call
            );
        });

        test('passes approval metadata separately from success status', async () => {
            const mocks = createMocks();

            // Create approval metadata to pass via constructor
            const approvalMetadata = new Map<
                string,
                { requireApproval: boolean; approvalStatus?: 'approved' | 'rejected' }
            >([['call-with-approval', { requireApproval: true, approvalStatus: 'approved' }]]);

            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true,
                approvalMetadata
            );

            const events = [
                {
                    type: 'tool-result',
                    toolCallId: 'call-with-approval',
                    toolName: 'approved_tool',
                    output: { result: 'approved execution' },
                },
                {
                    type: 'finish',
                    finishReason: 'stop',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // Verify success is in meta, approval metadata passed separately
            expect(mocks.contextManager.addToolResult).toHaveBeenCalledWith(
                'call-with-approval',
                'approved_tool',
                expect.objectContaining({
                    meta: expect.objectContaining({
                        success: true, // Success status is in sanitizedResult.meta
                    }),
                }),
                expect.objectContaining({
                    requireApproval: true,
                    approvalStatus: 'approved',
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
                mocks.resourceManager,
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

        test('captures token usage including reasoning tokens', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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

        test('subtracts cached input tokens from inputTokens when cachedInputTokens is present', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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

            expect(mocks.contextManager.updateAssistantMessage).toHaveBeenCalledWith('msg-1', {
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
            });
        });

        test('persists reasoning text to assistant message', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                mocks.resourceManager,
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

        test('emits llm:response with content, usage, provider, model', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            });
        });
    });

    describe('Error Event Handling', () => {
        test('emits llm:error with Error object', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const testError = new Error('Test error');
            const events = [{ type: 'error', error: testError }];

            await processor.process(() => createMockStream(events) as never);

            const errorEvent = mocks.emittedEvents.find((e) => e.name === 'llm:error');
            expect(errorEvent).toBeDefined();
            expect((errorEvent?.payload as { error: Error }).error).toBe(testError);
        });

        test('wraps non-Error in Error', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
                mocks.abortController.signal,
                mocks.config,
                mocks.logger,
                true
            );

            const events = [{ type: 'error', error: 'String error message' }];

            await processor.process(() => createMockStream(events) as never);

            const errorEvent = mocks.emittedEvents.find((e) => e.name === 'llm:error');
            expect(errorEvent).toBeDefined();
            expect((errorEvent?.payload as { error: Error }).error).toBeInstanceOf(Error);
            expect((errorEvent?.payload as { error: Error }).error.message).toBe(
                'String error message'
            );
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
                mocks.resourceManager,
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
                mocks.resourceManager,
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
    });

    describe('Edge Cases', () => {
        test('handles empty stream (only finish event)', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                mocks.resourceManager,
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
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'tool_a',
                    output: 'result a',
                },
                {
                    type: 'tool-result',
                    toolCallId: 'call-2',
                    toolName: 'tool_b',
                    output: 'result b',
                },
                {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
            ];

            await processor.process(() => createMockStream(events) as never);

            // NOTE: llm:tool-call is now emitted from ToolManager.executeTool() instead of StreamProcessor.
            // StreamProcessor still emits llm:tool-result events.
            const toolResultEvents = mocks.emittedEvents.filter(
                (e) => e.name === 'llm:tool-result'
            );

            expect(toolResultEvents).toHaveLength(2);

            // Verify both tool calls were persisted to context
            expect(mocks.contextManager.addToolCall).toHaveBeenCalledTimes(2);
        });

        test('handles interleaved text and tool calls', async () => {
            const mocks = createMocks();
            const processor = new StreamProcessor(
                mocks.contextManager,
                mocks.eventBus,
                mocks.resourceManager,
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
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'lookup',
                    output: 'found',
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
