import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactiveOverflowStrategy } from './reactive-overflow.js';
import type { InternalMessage } from '../../types.js';
import type { LanguageModel } from 'ai';
import { createMockLogger } from '../../../logger/v2/test-utils.js';
import { filterCompacted } from '../../utils.js';

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

        it('should set originalMessageCount as absolute index for filterCompacted compatibility', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Re-compacted summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // History with existing summary at index 2
            // - Indices 0-1: old messages (summarized by old summary)
            // - Index 2: old summary with originalMessageCount=2
            // - Indices 3-8: 6 messages after old summary
            const history: InternalMessage[] = [
                createUserMessage('Very old question', 1000),
                createAssistantMessage('Very old answer', 1001),
                createSummaryMessage('Previous summary', 2, 1002),
                // 6 messages after the summary
                createUserMessage('Q1', 2000),
                createAssistantMessage('A1', 2001),
                createUserMessage('Q2', 2002),
                createAssistantMessage('A2', 2003),
                createUserMessage('Q3', 2004),
                createAssistantMessage('A3', 2005),
            ];

            // Run re-compaction
            const result = await strategy.compact(history);
            expect(result).toHaveLength(1);

            const newSummary = result[0]!;
            expect(newSummary.metadata?.isRecompaction).toBe(true);

            // The existing summary is at index 2, and messagesAfterSummary has 6 messages
            // With default preserveLastNTurns=2, we split: toSummarize=2, toKeep=4
            // So originalMessageCount should be: (2 + 1) + 2 = 5 (absolute index)
            // NOT 2 (relative count of summarized messages)
            expect(newSummary.metadata?.originalMessageCount).toBe(5);

            // Simulate adding the new summary to history
            const historyAfterCompaction = [...history, newSummary];

            // Verify filterCompacted works correctly with the new summary
            const filtered = filterCompacted(historyAfterCompaction);

            // Should return: [newSummary, 4 preserved messages]
            // NOT: [newSummary, everything from index 2 onwards]
            expect(filtered).toHaveLength(5); // 1 summary + 4 preserved
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            // The preserved messages should be the last 4 (indices 5-8 in original)
            expect(filtered[1]?.role).toBe('user');
            expect(filtered[4]?.role).toBe('assistant');
        });

        it('should ensure filterCompacted does not return old summary or pre-summary messages after re-compaction', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>New summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // Large history to make the bug more obvious
            const history: InternalMessage[] = [];
            // 50 old messages (indices 0-49)
            for (let i = 0; i < 50; i++) {
                history.push(createUserMessage(`Old Q${i}`, 1000 + i * 2));
                history.push(createAssistantMessage(`Old A${i}`, 1001 + i * 2));
            }
            // Old summary at index 100 with originalMessageCount=90
            history.push(createSummaryMessage('Old summary', 90, 2000));
            // 30 more messages after the old summary (indices 101-130)
            for (let i = 0; i < 15; i++) {
                history.push(createUserMessage(`New Q${i}`, 3000 + i * 2));
                history.push(createAssistantMessage(`New A${i}`, 3001 + i * 2));
            }

            expect(history).toHaveLength(131);

            // Re-compaction should happen
            const result = await strategy.compact(history);
            expect(result).toHaveLength(1);

            const newSummary = result[0]!;
            expect(newSummary.metadata?.isRecompaction).toBe(true);

            // Add new summary to history
            const historyAfterCompaction = [...history, newSummary];

            // filterCompacted should NOT return the old summary or pre-old-summary messages
            const filtered = filterCompacted(historyAfterCompaction);

            // Check that the old summary is NOT in the filtered result
            const hasOldSummary = filtered.some(
                (msg) => msg.metadata?.isSummary && !msg.metadata?.isRecompaction
            );
            expect(hasOldSummary).toBe(false);

            // The filtered result should be much smaller than the original
            // With 30 messages after old summary, keeping ~20%, we should have:
            // ~6 preserved messages + 1 new summary = ~7 messages
            expect(filtered.length).toBeLessThan(20);
        });

        it('should handle three sequential compactions correctly', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary content</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // Helper to simulate adding messages and compacting
            let history: InternalMessage[] = [];

            // === PHASE 1: First compaction ===
            // Add 20 messages (10 turns)
            for (let i = 0; i < 10; i++) {
                history.push(createUserMessage(`Q${i}`, 1000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 1001 + i * 2));
            }
            expect(history).toHaveLength(20);

            // First compaction - no existing summary
            const result1 = await strategy.compact(history);
            expect(result1).toHaveLength(1);
            const summary1 = result1[0]!;
            expect(summary1.metadata?.isRecompaction).toBeUndefined();

            // Add summary1 to history
            history.push(summary1);
            expect(history).toHaveLength(21);

            // Verify filterCompacted after first compaction
            let filtered = filterCompacted(history);
            expect(filtered.length).toBeLessThan(15); // Should be summary + few preserved

            // === PHASE 2: Add more messages, then second compaction ===
            // Add 20 more messages after summary1
            for (let i = 10; i < 20; i++) {
                history.push(createUserMessage(`Q${i}`, 2000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 2001 + i * 2));
            }
            expect(history).toHaveLength(41);

            // Second compaction - should detect summary1
            const result2 = await strategy.compact(history);
            expect(result2).toHaveLength(1);
            const summary2 = result2[0]!;
            expect(summary2.metadata?.isRecompaction).toBe(true);

            // Add summary2 to history
            history.push(summary2);
            expect(history).toHaveLength(42);

            // Verify filterCompacted after second compaction
            filtered = filterCompacted(history);
            // Should return summary2 + preserved, NOT summary1
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            const hasSummary1 = filtered.some(
                (m) => m.metadata?.isSummary && !m.metadata?.isRecompaction
            );
            expect(hasSummary1).toBe(false);

            // === PHASE 3: Add more messages, then third compaction ===
            // Add 20 more messages after summary2
            for (let i = 20; i < 30; i++) {
                history.push(createUserMessage(`Q${i}`, 3000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 3001 + i * 2));
            }
            expect(history).toHaveLength(62);

            // Third compaction - should detect summary2 (most recent)
            const result3 = await strategy.compact(history);
            expect(result3).toHaveLength(1);
            const summary3 = result3[0]!;
            expect(summary3.metadata?.isRecompaction).toBe(true);

            // Add summary3 to history
            history.push(summary3);
            expect(history).toHaveLength(63);

            // Verify filterCompacted after third compaction
            filtered = filterCompacted(history);

            // Critical assertions:
            // 1. Most recent summary (summary3) should be first
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            expect(filtered[0]).toBe(summary3);

            // 2. Neither summary1 nor summary2 should be in the result
            const oldSummaries = filtered.filter((m) => m.metadata?.isSummary && m !== summary3);
            expect(oldSummaries).toHaveLength(0);

            // 3. Result should be much smaller than total history
            expect(filtered.length).toBeLessThan(20);

            // 4. All messages in filtered result should be either:
            //    - summary3, or
            //    - messages with timestamps from the most recent batch (3000+)
            for (const msg of filtered) {
                if (msg === summary3) continue;
                // Recent messages should have timestamps >= 3000
                expect(msg.timestamp).toBeGreaterThanOrEqual(3000);
            }
        });

        it('should work correctly with manual compaction followed by automatic compaction', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            // Simulate manual compaction first
            let history: InternalMessage[] = [];
            for (let i = 0; i < 10; i++) {
                history.push(createUserMessage(`Q${i}`, 1000 + i));
                history.push(createAssistantMessage(`A${i}`, 1000 + i));
            }

            // Manual compaction (uses same compact() method)
            const manualResult = await strategy.compact(history);
            expect(manualResult).toHaveLength(1);
            history.push(manualResult[0]!);

            // Add more messages
            for (let i = 10; i < 20; i++) {
                history.push(createUserMessage(`Q${i}`, 2000 + i));
                history.push(createAssistantMessage(`A${i}`, 2000 + i));
            }

            // Automatic compaction (also uses same compact() method)
            const autoResult = await strategy.compact(history);
            expect(autoResult).toHaveLength(1);
            expect(autoResult[0]?.metadata?.isRecompaction).toBe(true);
            history.push(autoResult[0]!);

            // Verify final state
            const filtered = filterCompacted(history);
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);

            // Only the most recent summary should be visible
            const summaryCount = filtered.filter((m) => m.metadata?.isSummary).length;
            expect(summaryCount).toBe(1);
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
