import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactiveOverflowCompactionStrategy } from './reactive-overflow-compaction.js';
import type { InternalMessage } from '../../types.js';
import type { LanguageModel } from 'ai';
import { createMockLogger } from '../../../logger/v2/test-utils.js';
import { filterCompacted } from '../../utils.js';
import type { CompactionRuntimeContext } from '../types.js';

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

describe('ReactiveOverflowCompactionStrategy', () => {
    const logger = createMockLogger();
    let strategy: ReactiveOverflowCompactionStrategy;
    let mockModel: LanguageModel;

    beforeEach(() => {
        vi.clearAllMocks();
        mockModel = createMockModel();
        strategy = new ReactiveOverflowCompactionStrategy({});
    });

    function createContext(): CompactionRuntimeContext {
        return {
            sessionId: 'test-session',
            model: mockModel,
            logger,
        };
    }

    describe('compact() - short history guard', () => {
        it('should return empty array when history has 2 or fewer messages', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Hello'),
                createAssistantMessage('Hi there!'),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should return empty array for empty history', async () => {
            const result = await strategy.compact([], createContext());

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should return empty array for single message', async () => {
            const history: InternalMessage[] = [createUserMessage('Hello')];

            const result = await strategy.compact(history, createContext());

            expect(result).toEqual([]);
        });
    });

    describe('compact() - summary message metadata', () => {
        it('should return summary with isSummary=true metadata', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('First question', 1000),
                createAssistantMessage('First answer', 1001),
                createUserMessage('Second question', 1002),
                createAssistantMessage('Second answer', 1003),
                createUserMessage('Third question', 1004),
                createAssistantMessage('Third answer', 1005),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isSummary).toBe(true);
        });

        it('should set originalMessageCount to number of summarized messages', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Test summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Old question 1', 1000),
                createAssistantMessage('Old answer 1', 1001),
                createUserMessage('Recent question 1', 1002),
                createAssistantMessage('Recent answer 1', 1003),
                createUserMessage('Recent question 2', 1004),
                createAssistantMessage('Recent answer 2', 1005),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toHaveLength(1);
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
            const result = await strategy.compact(history, createContext());
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

            const result = await strategy.compact(history, createContext());

            expect(result[0]?.metadata?.originalFirstTimestamp).toBe(1000);
            expect(result[0]?.metadata?.originalLastTimestamp).toBe(2000);
        });
    });

    describe('compact() - re-compaction with existing summary', () => {
        it('should detect existing summary and only summarize messages after it', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>New summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Very old question', 1000),
                createAssistantMessage('Very old answer', 1001),
                createSummaryMessage('Previous summary', 2, 1002),
                createUserMessage('Question after summary 1', 2000),
                createAssistantMessage('Answer after summary 1', 2001),
                createUserMessage('Question after summary 2', 2002),
                createAssistantMessage('Answer after summary 2', 2003),
                createUserMessage('Question after summary 3', 2004),
                createAssistantMessage('Answer after summary 3', 2005),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isRecompaction).toBe(true);
        });

        it('should skip re-compaction if few messages after existing summary', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Old question', 1000),
                createAssistantMessage('Old answer', 1001),
                createSummaryMessage('Existing summary', 2, 1002),
                createUserMessage('New question', 2000),
                createAssistantMessage('New answer', 2001),
                createUserMessage('Another question', 2002),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toEqual([]);
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('should find most recent summary when multiple exist', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Newest summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 100),
                createSummaryMessage('First summary', 1, 200),
                createUserMessage('Old question', 300),
                createAssistantMessage('Old answer', 301),
                createSummaryMessage('Second summary', 2, 400),
                createUserMessage('Q1', 500),
                createAssistantMessage('A1', 501),
                createUserMessage('Q2', 502),
                createAssistantMessage('A2', 503),
                createUserMessage('Q3', 504),
                createAssistantMessage('A3', 505),
            ];

            const result = await strategy.compact(history, createContext());

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isRecompaction).toBe(true);
        });

        it('should set originalMessageCount as absolute index for filterCompacted compatibility', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Re-compacted summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Very old question', 1000),
                createAssistantMessage('Very old answer', 1001),
                createSummaryMessage('Previous summary', 2, 1002),
                createUserMessage('Q1', 2000),
                createAssistantMessage('A1', 2001),
                createUserMessage('Q2', 2002),
                createAssistantMessage('A2', 2003),
                createUserMessage('Q3', 2004),
                createAssistantMessage('A3', 2005),
            ];

            const result = await strategy.compact(history, createContext());
            expect(result).toHaveLength(1);

            const newSummary = result[0]!;
            expect(newSummary.metadata?.isRecompaction).toBe(true);
            expect(newSummary.metadata?.originalMessageCount).toBe(5);

            const historyAfterCompaction = [...history, newSummary];
            const filtered = filterCompacted(historyAfterCompaction);

            expect(filtered).toHaveLength(5);
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            expect(filtered[1]?.role).toBe('user');
            expect(filtered[4]?.role).toBe('assistant');
        });

        it('should ensure filterCompacted does not return old summary or pre-summary messages after re-compaction', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>New summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [];
            for (let i = 0; i < 50; i++) {
                history.push(createUserMessage(`Old Q${i}`, 1000 + i * 2));
                history.push(createAssistantMessage(`Old A${i}`, 1001 + i * 2));
            }
            history.push(createSummaryMessage('Old summary', 90, 2000));
            for (let i = 0; i < 15; i++) {
                history.push(createUserMessage(`New Q${i}`, 3000 + i * 2));
                history.push(createAssistantMessage(`New A${i}`, 3001 + i * 2));
            }

            expect(history).toHaveLength(131);

            const result = await strategy.compact(history, createContext());
            expect(result).toHaveLength(1);

            const newSummary = result[0]!;
            expect(newSummary.metadata?.isRecompaction).toBe(true);

            const historyAfterCompaction = [...history, newSummary];
            const filtered = filterCompacted(historyAfterCompaction);

            const hasOldSummary = filtered.some(
                (msg) => msg.metadata?.isSummary && !msg.metadata?.isRecompaction
            );
            expect(hasOldSummary).toBe(false);
            expect(filtered.length).toBeLessThan(20);
        });

        it('should handle three sequential compactions correctly', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary content</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            let history: InternalMessage[] = [];

            for (let i = 0; i < 10; i++) {
                history.push(createUserMessage(`Q${i}`, 1000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 1001 + i * 2));
            }
            expect(history).toHaveLength(20);

            const result1 = await strategy.compact(history, createContext());
            expect(result1).toHaveLength(1);
            const summary1 = result1[0]!;
            expect(summary1.metadata?.isRecompaction).toBeUndefined();

            history.push(summary1);
            expect(history).toHaveLength(21);

            let filtered = filterCompacted(history);
            expect(filtered.length).toBeLessThan(15);

            for (let i = 10; i < 20; i++) {
                history.push(createUserMessage(`Q${i}`, 2000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 2001 + i * 2));
            }
            expect(history).toHaveLength(41);

            const result2 = await strategy.compact(history, createContext());
            expect(result2).toHaveLength(1);
            const summary2 = result2[0]!;
            expect(summary2.metadata?.isRecompaction).toBe(true);

            history.push(summary2);
            expect(history).toHaveLength(42);

            filtered = filterCompacted(history);
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            const hasSummary1 = filtered.some(
                (m) => m.metadata?.isSummary && !m.metadata?.isRecompaction
            );
            expect(hasSummary1).toBe(false);

            for (let i = 20; i < 30; i++) {
                history.push(createUserMessage(`Q${i}`, 3000 + i * 2));
                history.push(createAssistantMessage(`A${i}`, 3001 + i * 2));
            }
            expect(history).toHaveLength(62);

            const result3 = await strategy.compact(history, createContext());
            expect(result3).toHaveLength(1);
            const summary3 = result3[0]!;
            expect(summary3.metadata?.isRecompaction).toBe(true);

            history.push(summary3);
            expect(history).toHaveLength(63);

            filtered = filterCompacted(history);

            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);
            expect(filtered[0]).toBe(summary3);

            const oldSummaries = filtered.filter((m) => m.metadata?.isSummary && m !== summary3);
            expect(oldSummaries).toHaveLength(0);
            expect(filtered.length).toBeLessThan(20);

            for (const msg of filtered) {
                if (msg === summary3) continue;
                expect(msg.timestamp).toBeGreaterThanOrEqual(3000);
            }
        });

        it('should work correctly with manual compaction followed by automatic compaction', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            let history: InternalMessage[] = [];
            for (let i = 0; i < 10; i++) {
                history.push(createUserMessage(`Q${i}`, 1000 + i));
                history.push(createAssistantMessage(`A${i}`, 1000 + i));
            }

            const manualResult = await strategy.compact(history, createContext());
            expect(manualResult).toHaveLength(1);
            history.push(manualResult[0]!);

            for (let i = 10; i < 20; i++) {
                history.push(createUserMessage(`Q${i}`, 2000 + i));
                history.push(createAssistantMessage(`A${i}`, 2000 + i));
            }

            const autoResult = await strategy.compact(history, createContext());
            expect(autoResult).toHaveLength(1);
            expect(autoResult[0]?.metadata?.isRecompaction).toBe(true);
            history.push(autoResult[0]!);

            const filtered = filterCompacted(history);
            expect(filtered[0]?.metadata?.isRecompaction).toBe(true);

            const summaryCount = filtered.filter((m) => m.metadata?.isSummary).length;
            expect(summaryCount).toBe(1);
        });
    });

    describe('compact() - history splitting', () => {
        it('should preserve last N turns based on options', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const customStrategy = new ReactiveOverflowCompactionStrategy({
                strategy: { preserveLastNTurns: 3 },
            });

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

            const result = await customStrategy.compact(history, createContext());

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.originalMessageCount).toBe(2);
        });

        it('should return empty when message count is at or below minKeep threshold', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Q1', 1000),
                createAssistantMessage('A1', 1001),
                createUserMessage('Q2', 2000),
            ];

            const result = await strategy.compact(history, createContext());

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

            const result = await strategy.compact(history, createContext());

            expect(result).toHaveLength(1);
            expect(result[0]?.metadata?.isSummary).toBe(true);
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

            const result = await strategy.compact(history, createContext());

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

            const result = await strategy.compact(history, createContext());

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

            await strategy.compact(history, createContext());

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

            await strategy.compact(history, createContext());

            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('[Used tools: read_file]'),
                })
            );
        });
    });

    describe('getSettings()', () => {
        it('should return compaction settings', () => {
            const settings = strategy.getSettings();
            expect(settings.enabled).toBe(true);
            expect(settings.thresholdPercent).toBe(0.9);
        });

        it('should respect enabled option', () => {
            const disabledStrategy = new ReactiveOverflowCompactionStrategy({ enabled: false });
            const settings = disabledStrategy.getSettings();
            expect(settings.enabled).toBe(false);
        });

        it('should respect maxContextTokens option', () => {
            const limitedStrategy = new ReactiveOverflowCompactionStrategy({
                maxContextTokens: 10000,
            });
            const settings = limitedStrategy.getSettings();
            expect(settings.maxContextTokens).toBe(10000);
        });
    });

    describe('getModelLimits()', () => {
        it('should return context window when no maxContextTokens set', () => {
            const limits = strategy.getModelLimits(100000);
            expect(limits.contextWindow).toBe(100000);
        });

        it('should cap context window when maxContextTokens is set', () => {
            const limitedStrategy = new ReactiveOverflowCompactionStrategy({
                maxContextTokens: 50000,
            });
            const limits = limitedStrategy.getModelLimits(100000);
            expect(limits.contextWindow).toBe(50000);
        });

        it('should not cap when model window is smaller than maxContextTokens', () => {
            const limitedStrategy = new ReactiveOverflowCompactionStrategy({
                maxContextTokens: 100000,
            });
            const limits = limitedStrategy.getModelLimits(50000);
            expect(limits.contextWindow).toBe(50000);
        });
    });

    describe('shouldCompact()', () => {
        it('should return false when disabled', () => {
            const disabledStrategy = new ReactiveOverflowCompactionStrategy({ enabled: false });
            const limits = { contextWindow: 100000 };
            expect(disabledStrategy.shouldCompact(90000, limits)).toBe(false);
        });

        it('should return false when under threshold', () => {
            const limits = { contextWindow: 100000 };
            expect(strategy.shouldCompact(80000, limits)).toBe(false);
        });

        it('should return true when over threshold', () => {
            const limits = { contextWindow: 100000 };
            expect(strategy.shouldCompact(95000, limits)).toBe(true);
        });

        it('should respect custom thresholdPercent', () => {
            const customStrategy = new ReactiveOverflowCompactionStrategy({
                thresholdPercent: 0.5,
            });
            const limits = { contextWindow: 100000 };
            expect(customStrategy.shouldCompact(60000, limits)).toBe(true);
            expect(customStrategy.shouldCompact(40000, limits)).toBe(false);
        });
    });
});
