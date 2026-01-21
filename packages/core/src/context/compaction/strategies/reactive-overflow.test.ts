import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactiveOverflowStrategy } from './reactive-overflow.js';
import type { InternalMessage } from '../../types.js';
import type { LanguageModel } from 'ai';
import { createMockLogger } from '../../../logger/v2/test-utils.js';

// Mock the ai module
vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        generateText: vi.fn(),
    };
});

import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

/**
 * Helper to create a mock LanguageModel
 */
function createMockModel(): LanguageModel {
    return {
        modelId: 'test-model',
        provider: 'test-provider',
        specificationVersion: 'v1',
        doStream: vi.fn(),
        doGenerate: vi.fn(),
    } as unknown as LanguageModel;
}

/**
 * Helper to create test messages
 */
function createUserMessage(text: string, timestamp?: number): InternalMessage {
    return {
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
    };
}

function createAssistantMessage(text: string, timestamp?: number): InternalMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
    };
}

function createSummaryMessage(
    text: string,
    originalMessageCount: number,
    timestamp?: number
): InternalMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
        metadata: {
            isSummary: true,
            summarizedAt: Date.now(),
            originalMessageCount,
        },
    };
}

describe('ReactiveOverflowStrategy', () => {
    const logger = createMockLogger();
    let strategy: ReactiveOverflowStrategy;

    beforeEach(() => {
        vi.clearAllMocks();
        strategy = new ReactiveOverflowStrategy(createMockModel(), {}, logger);
    });

    describe('compact() - short history guard', () => {
        it('should return empty array when history has 2 or fewer messages', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Hello'),
                createAssistantMessage('Hi there!'),
            ];

            const result = await strategy.compact(history);

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should return empty array for empty history', async () => {
            const result = await strategy.compact([]);

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should return empty array for single message', async () => {
            const history: InternalMessage[] = [createUserMessage('Hello')];

            const result = await strategy.compact(history);

            expect(result).toEqual([]);
        });
    });

    describe('compact() - summary message metadata', () => {
        it('should return summary with isSummary=true metadata', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // Create enough messages to trigger compaction
            // preserveLastNTurns=2 by default, so we need more than 2 turns
            const history: InternalMessage[] = [
                createUserMessage('First question', 1000),
                createAssistantMessage('First answer', 1001),
                createUserMessage('Second question', 1002),
                createAssistantMessage('Second answer', 1003),
                createUserMessage('Third question', 1004),
                createAssistantMessage('Third answer', 1005),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isSummary).toBe(true);
        });

        it('should set originalMessageCount to number of summarized messages', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // 6 messages total, preserveLastNTurns=2 means last 4 messages are kept
            // (2 turns = 2 user + 2 assistant messages in the last 2 turns)
            const history: InternalMessage[] = [
                createUserMessage('Old question 1', 1000),
                createAssistantMessage('Old answer 1', 1001),
                createUserMessage('Recent question 1', 1002),
                createAssistantMessage('Recent answer 1', 1003),
                createUserMessage('Recent question 2', 1004),
                createAssistantMessage('Recent answer 2', 1005),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            // First 2 messages (1 turn) should be summarized
            expect(result[0]?.metadata?.originalMessageCount).toBe(2);
        });

        it('should include summarizedAt timestamp in metadata', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Question 1', 1000),
                createAssistantMessage('Answer 1', 1001),
                createUserMessage('Question 2', 1002),
                createAssistantMessage('Answer 2', 1003),
                createUserMessage('Question 3', 1004),
                createAssistantMessage('Answer 3', 1005),
            ];

            const beforeTime = Date.now();
            const result = await strategy.compact(history);
            const afterTime = Date.now();

            expect(result[0]?.metadata?.summarizedAt).toBeGreaterThanOrEqual(beforeTime);
            expect(result[0]?.metadata?.summarizedAt).toBeLessThanOrEqual(afterTime);
        });

        it('should include original timestamps in metadata', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Old question', 1000),
                createAssistantMessage('Old answer', 2000),
                createUserMessage('Recent question 1', 3000),
                createAssistantMessage('Recent answer 1', 4000),
                createUserMessage('Recent question 2', 5000),
                createAssistantMessage('Recent answer 2', 6000),
            ];

            const result = await strategy.compact(history);

            expect(result[0]?.metadata?.originalFirstTimestamp).toBe(1000);
            expect(result[0]?.metadata?.originalLastTimestamp).toBe(2000);
        });
    });

    describe('compact() - re-compaction with existing summary', () => {
        it('should detect existing summary and only summarize messages after it', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>New summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // History with existing summary
            const history: InternalMessage[] = [
                createUserMessage('Very old question', 1000),
                createAssistantMessage('Very old answer', 1001),
                createSummaryMessage('Previous summary', 2, 1002),
                // Messages after the summary
                createUserMessage('Question after summary 1', 2000),
                createAssistantMessage('Answer after summary 1', 2001),
                createUserMessage('Question after summary 2', 2002),
                createAssistantMessage('Answer after summary 2', 2003),
                createUserMessage('Question after summary 3', 2004),
                createAssistantMessage('Answer after summary 3', 2005),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            // Should mark as re-compaction
            expect(result[0]?.metadata?.isRecompaction).toBe(true);
        });

        it('should skip re-compaction if few messages after existing summary', async () => {
            // History with summary and only 3 messages after (threshold is 4)
            const history: InternalMessage[] = [
                createUserMessage('Old question', 1000),
                createAssistantMessage('Old answer', 1001),
                createSummaryMessage('Existing summary', 2, 1002),
                createUserMessage('New question', 2000),
                createAssistantMessage('New answer', 2001),
                createUserMessage('Another question', 2002),
            ];

            const result = await strategy.compact(history);

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should find most recent summary when multiple exist', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Newest summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // History with two summaries - should use the most recent one
            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 100),
                createSummaryMessage('First summary', 1, 200),
                createUserMessage('Old question', 300),
                createAssistantMessage('Old answer', 301),
                createSummaryMessage('Second summary', 2, 400),
                // Messages after second summary
                createUserMessage('Q1', 500),
                createAssistantMessage('A1', 501),
                createUserMessage('Q2', 502),
                createAssistantMessage('A2', 503),
                createUserMessage('Q3', 504),
                createAssistantMessage('A3', 505),
            ];

            const result = await strategy.compact(history);

            // Should have re-compaction metadata
            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isRecompaction).toBe(true);
        });
    });

    describe('compact() - history splitting', () => {
        it('should preserve last N turns based on options', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // Create strategy with custom preserveLastNTurns
            const customStrategy = new ReactiveOverflowStrategy(
                createMockModel(),
                { preserveLastNTurns: 3 },
                logger
            );

            // 8 messages = 4 turns, with preserveLastNTurns=3, first turn should be summarized
            const history: InternalMessage[] = [
                createUserMessage('Turn 1 Q', 1000),
                createAssistantMessage('Turn 1 A', 1001),
                createUserMessage('Turn 2 Q', 2000),
                createAssistantMessage('Turn 2 A', 2001),
                createUserMessage('Turn 3 Q', 3000),
                createAssistantMessage('Turn 3 A', 3001),
                createUserMessage('Turn 4 Q', 4000),
                createAssistantMessage('Turn 4 A', 4001),
            ];

            const result = await customStrategy.compact(history);

            expect(result).toHaveLength(1);
            // Only first turn (2 messages) should be summarized
            expect(result[0]?.metadata?.originalMessageCount).toBe(2);
        });

        it('should return empty when message count is at or below minKeep threshold', async () => {
            // The fallback logic uses minKeep=3, so with 3 or fewer messages
            // nothing should be summarized
            const history: InternalMessage[] = [
                createUserMessage('Q1', 1000),
                createAssistantMessage('A1', 1001),
                createUserMessage('Q2', 2000),
            ];

            const result = await strategy.compact(history);

            // 3 messages <= minKeep(3), so nothing to summarize
            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });
    });

    describe('compact() - LLM failure fallback', () => {
        it('should create fallback summary when LLM call fails', async () => {
            mockGenerateText.mockRejectedValue(new Error('LLM API error'));

            const history: InternalMessage[] = [
                createUserMessage('Question 1', 1000),
                createAssistantMessage('Answer 1', 1001),
                createUserMessage('Question 2', 2000),
                createAssistantMessage('Answer 2', 2001),
                createUserMessage('Question 3', 3000),
                createAssistantMessage('Answer 3', 3001),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isSummary).toBe(true);
            // Fallback summary should still have XML structure
            const content = result[0]?.content;
            expect(content).toBeDefined();
            expect(content![0]).toMatchObject({
                type: 'text',
                text: expect.stringContaining('<session_compaction>'),
            });
            expect(content![0]).toMatchObject({
                type: 'text',
                text: expect.stringContaining('Fallback'),
            });
        });

        it('should include current task in fallback summary', async () => {
            mockGenerateText.mockRejectedValue(new Error('LLM API error'));

            const history: InternalMessage[] = [
                createUserMessage('Old question', 1000),
                createAssistantMessage('Old answer', 1001),
                createUserMessage('Recent question 1', 2000),
                createAssistantMessage('Recent answer 1', 2001),
                createUserMessage('My current task is to fix the bug', 3000),
                createAssistantMessage('Working on it', 3001),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            const content = result[0]!.content;
            expect(content).not.toBeNull();
            const firstContent = content![0];
            const summaryText = firstContent?.type === 'text' ? firstContent.text : '';
            expect(summaryText).toContain('<current_task>');
        });
    });

    describe('compact() - summary content', () => {
        it('should prefix summary with [Session Compaction Summary]', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>LLM generated content</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Q1', 1000),
                createAssistantMessage('A1', 1001),
                createUserMessage('Q2', 2000),
                createAssistantMessage('A2', 2001),
                createUserMessage('Q3', 3000),
                createAssistantMessage('A3', 3001),
            ];

            const result = await strategy.compact(history);

            expect(result).toHaveLength(1);
            const content = result[0]!.content;
            expect(content).not.toBeNull();
            const firstContent = content![0];
            const summaryText = firstContent?.type === 'text' ? firstContent.text : '';
            expect(summaryText).toMatch(/^\[Session Compaction Summary\]/);
        });

        it('should pass conversation to LLM with proper formatting', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('What is 2+2?', 1000),
                createAssistantMessage('The answer is 4', 1001),
                createUserMessage('Thanks!', 2000),
                createAssistantMessage('You are welcome', 2001),
                createUserMessage('New question', 3000),
                createAssistantMessage('New answer', 3001),
            ];

            await strategy.compact(history);

            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('USER: What is 2+2?'),
                })
            );
            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('ASSISTANT: The answer is 4'),
                })
            );
        });
    });

    describe('compact() - tool message handling', () => {
        it('should include tool call information in summary', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary with tools</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Read the file', 1000),
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Let me read that file' }],
                    timestamp: 1001,
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{"path": "/test.txt"}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: [{ type: 'text', text: 'File contents here' }],
                    timestamp: 1002,
                    name: 'read_file',
                    toolCallId: 'call-1',
                },
                createUserMessage('Q2', 2000),
                createAssistantMessage('A2', 2001),
                createUserMessage('Q3', 3000),
                createAssistantMessage('A3', 3001),
            ];

            await strategy.compact(history);

            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('[Used tools: read_file]'),
                })
            );
        });
    });
});
