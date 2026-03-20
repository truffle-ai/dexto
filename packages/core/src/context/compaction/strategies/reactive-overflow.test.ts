import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactiveOverflowCompactionStrategy } from './reactive-overflow-compaction.js';
import type { InternalMessage } from '../../types.js';
import type { LanguageModel } from 'ai';
import { createMockLogger } from '../../../logger/v2/test-utils.js';
import { filterCompacted } from '../../utils.js';
import type { CompactionRuntimeContext, CompactionResult } from '../types.js';
import { buildCompactionWindow } from '../window.js';

vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        generateText: vi.fn(),
    };
});

import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

function createMockModel(): LanguageModel {
    return {
        modelId: 'test-model',
        provider: 'test-provider',
        specificationVersion: 'v1',
        doStream: vi.fn(),
        doGenerate: vi.fn(),
    } as unknown as LanguageModel;
}

function createUserMessage(text: string, timestamp?: number): InternalMessage {
    return {
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
        id: `user-${text}-${timestamp ?? 0}`,
    };
}

function createAssistantMessage(text: string, timestamp?: number): InternalMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
        id: `assistant-${text}-${timestamp ?? 0}`,
    };
}

function createSummaryMessage(
    text: string,
    preservedMessageIds: string[],
    timestamp?: number
): InternalMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: timestamp ?? Date.now(),
        id: `summary-${text}-${timestamp ?? 0}`,
        metadata: {
            isSummary: true,
            preservedMessageIds,
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

    async function compactHistory(
        history: readonly InternalMessage[]
    ): Promise<CompactionResult | null> {
        return await strategy.compact(buildCompactionWindow(history), createContext());
    }

    function materializeSummary(
        history: readonly InternalMessage[],
        result: CompactionResult
    ): InternalMessage {
        const compactionWindow = buildCompactionWindow(history);
        const summary = structuredClone(result.summaryMessages[0]!);
        const preservedMessageIds = compactionWindow.workingHistory
            .slice(result.preserveFromWorkingIndex)
            .map((message) => {
                if (!message.id) {
                    throw new Error('Expected preserved working message to have a stable id');
                }
                return message.id;
            });
        summary.metadata = {
            ...(summary.metadata ?? {}),
            isSummary: true,
            preservedMessageIds,
        };
        if (compactionWindow.latestSummary && summary.metadata?.isRecompaction !== true) {
            summary.metadata.isRecompaction = true;
        }
        if (summary.metadata) {
            delete summary.metadata.originalMessageCount;
        }
        return summary;
    }

    describe('compact()', () => {
        it('returns null when the working history is too short', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Hello', 1000),
                createAssistantMessage('Hi there', 1001),
            ];

            const result = await compactHistory(history);

            expect(result).toBeNull();
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('returns a structured summary and working-history boundary', async () => {
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

            const result = await compactHistory(history);

            expect(result).not.toBeNull();
            expect(result?.summaryMessages).toHaveLength(1);
            expect(result?.summaryMessages[0]?.metadata?.isSummary).toBe(true);
            expect(result?.preserveFromWorkingIndex).toBe(2);
        });

        it('recompacts against the logical working window instead of raw stored indexes', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>New summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 1000),
                createAssistantMessage('Ancient answer', 1001),
                createUserMessage('Preserved question', 1002),
                createAssistantMessage('Preserved answer', 1003),
                createSummaryMessage(
                    'Previous summary',
                    ['user-Preserved question-1002', 'assistant-Preserved answer-1003'],
                    1004
                ),
                createUserMessage('Fresh question 1', 2000),
                createAssistantMessage('Fresh answer 1', 2001),
                createUserMessage('Fresh question 2', 2002),
                createAssistantMessage('Fresh answer 2', 2003),
                createUserMessage('Fresh question 3', 2004),
                createAssistantMessage('Fresh answer 3', 2005),
            ];

            const result = await compactHistory(history);

            expect(result).not.toBeNull();
            expect(result?.summaryMessages).toHaveLength(1);
            expect(result?.summaryMessages[0]?.metadata?.isRecompaction).toBe(true);
            expect(result?.preserveFromWorkingIndex).toBe(4);
        });

        it('skips recompaction when no working-history prefix is eligible after the latest summary', async () => {
            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 1000),
                createAssistantMessage('Ancient answer', 1001),
                createSummaryMessage('Previous summary', [], 1002),
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Thinking through the task' }],
                    timestamp: 2000,
                    id: 'assistant-thinking',
                },
                {
                    role: 'tool',
                    content: [{ type: 'text', text: 'Tool output' }],
                    timestamp: 2001,
                    id: 'tool-output',
                    name: 'read_file',
                    toolCallId: 'call-1',
                },
                createAssistantMessage('Still working on it', 2002),
            ];

            const result = await compactHistory(history);

            expect(result).toBeNull();
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it('produces summaries that can supersede older summaries without pulling them back into filterCompacted()', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Replacement summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const oldSummary = createSummaryMessage(
                'Old summary',
                ['user-Preserved question-1002', 'assistant-Preserved answer-1003'],
                1004
            );
            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 1000),
                createAssistantMessage('Ancient answer', 1001),
                createUserMessage('Preserved question', 1002),
                createAssistantMessage('Preserved answer', 1003),
                oldSummary,
                createUserMessage('Fresh question 1', 2000),
                createAssistantMessage('Fresh answer 1', 2001),
                createUserMessage('Fresh question 2', 2002),
                createAssistantMessage('Fresh answer 2', 2003),
                createUserMessage('Fresh question 3', 2004),
                createAssistantMessage('Fresh answer 3', 2005),
            ];

            const result = await compactHistory(history);
            if (!result) {
                throw new Error('Expected compaction result');
            }

            const replacementSummary = materializeSummary(history, result);
            const filtered = filterCompacted([...history, replacementSummary]);

            expect(filtered[0]).toEqual(replacementSummary);
            expect(filtered).not.toContain(oldSummary);
            expect(
                filtered.some(
                    (message) => message.metadata?.isSummary && message !== replacementSummary
                )
            ).toBe(false);
        });

        it('passes the latest summary content into the next compaction prompt', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Replacement summary</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Ancient question', 1000),
                createAssistantMessage('Ancient answer', 1001),
                createUserMessage('Preserved question', 1002),
                createAssistantMessage('Preserved answer', 1003),
                createSummaryMessage(
                    '[Session Compaction Summary]\nPrevious summary',
                    ['user-Preserved question-1002', 'assistant-Preserved answer-1003'],
                    1004
                ),
                createUserMessage('Fresh question 1', 2000),
                createAssistantMessage('Fresh answer 1', 2001),
                createUserMessage('Fresh question 2', 2002),
                createAssistantMessage('Fresh answer 2', 2003),
                createUserMessage('Fresh question 3', 2004),
                createAssistantMessage('Fresh answer 3', 2005),
            ];

            await compactHistory(history);

            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('[Session Compaction Summary]'),
                })
            );
        });

        it('passes conversation content to the LLM with proper formatting', async () => {
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

            await compactHistory(history);

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

        it('includes tool call information in the summary prompt', async () => {
            mockGenerateText.mockResolvedValue({
                text: '<session_compaction>Summary with tools</session_compaction>',
            } as Awaited<ReturnType<typeof generateText>>);

            const history: InternalMessage[] = [
                createUserMessage('Read the file', 1000),
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Let me read that file' }],
                    timestamp: 1001,
                    id: 'assistant-tool-call',
                    toolCalls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'read_file', arguments: '{"path":"/test.txt"}' },
                        },
                    ],
                },
                {
                    role: 'tool',
                    content: [{ type: 'text', text: 'File contents here' }],
                    timestamp: 1002,
                    id: 'tool-result',
                    name: 'read_file',
                    toolCallId: 'call-1',
                },
                createUserMessage('Q2', 2000),
                createAssistantMessage('A2', 2001),
                createUserMessage('Q3', 3000),
                createAssistantMessage('A3', 3001),
            ];

            await compactHistory(history);

            expect(mockGenerateText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('[Used tools: read_file]'),
                })
            );
        });

        it('creates a fallback summary when the LLM call fails', async () => {
            mockGenerateText.mockRejectedValue(new Error('LLM API error'));

            const history: InternalMessage[] = [
                createUserMessage('Question 1', 1000),
                createAssistantMessage('Answer 1', 1001),
                createUserMessage('Question 2', 2000),
                createAssistantMessage('Answer 2', 2001),
                createUserMessage('Question 3', 3000),
                createAssistantMessage('Answer 3', 3001),
            ];

            const result = await compactHistory(history);

            expect(result).not.toBeNull();
            const summaryText =
                result?.summaryMessages[0]?.content?.[0]?.type === 'text'
                    ? result.summaryMessages[0].content[0].text
                    : '';
            expect(summaryText).toContain('<session_compaction>');
            expect(summaryText).toContain('Fallback');
        });
    });

    describe('getSettings()', () => {
        it('returns compaction settings', () => {
            const settings = strategy.getSettings();
            expect(settings.enabled).toBe(true);
            expect(settings.thresholdPercent).toBe(0.9);
        });

        it('respects enabled option', () => {
            const disabledStrategy = new ReactiveOverflowCompactionStrategy({ enabled: false });
            const settings = disabledStrategy.getSettings();
            expect(settings.enabled).toBe(false);
        });

        it('respects maxContextTokens option', () => {
            const limitedStrategy = new ReactiveOverflowCompactionStrategy({
                maxContextTokens: 10000,
            });
            const settings = limitedStrategy.getSettings();
            expect(settings.maxContextTokens).toBe(10000);
        });
    });

    describe('getModelLimits()', () => {
        it('returns context window when no maxContextTokens is set', () => {
            const limits = strategy.getModelLimits(100000);
            expect(limits.contextWindow).toBe(100000);
        });

        it('caps the context window when maxContextTokens is set', () => {
            const limitedStrategy = new ReactiveOverflowCompactionStrategy({
                maxContextTokens: 50000,
            });
            const limits = limitedStrategy.getModelLimits(100000);
            expect(limits.contextWindow).toBe(50000);
        });
    });

    describe('shouldCompact()', () => {
        it('returns false when disabled', () => {
            const disabledStrategy = new ReactiveOverflowCompactionStrategy({ enabled: false });
            const limits = { contextWindow: 100000 };
            expect(disabledStrategy.shouldCompact(90000, limits)).toBe(false);
        });

        it('returns false when under threshold', () => {
            const limits = { contextWindow: 100000 };
            expect(strategy.shouldCompact(80000, limits)).toBe(false);
        });

        it('returns true when over threshold', () => {
            const limits = { contextWindow: 100000 };
            expect(strategy.shouldCompact(95000, limits)).toBe(true);
        });
    });
});
