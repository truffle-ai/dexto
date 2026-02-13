import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../manager.js';
import { filterCompacted } from '../utils.js';
import { ReactiveOverflowCompactionStrategy } from './strategies/reactive-overflow-compaction.js';
import { VercelMessageFormatter } from '../../llm/formatters/vercel.js';
import { SystemPromptManager } from '../../systemPrompt/manager.js';
import { SystemPromptConfigSchema } from '../../systemPrompt/schemas.js';
import { MemoryHistoryProvider } from '../../session/history/memory.js';
import { ResourceManager } from '../../resources/index.js';
import { MCPManager } from '../../mcp/manager.js';
import { MemoryManager } from '../../memory/index.js';
import { StorageManager } from '../../storage/storage-manager.js';
import { createInMemoryStorageManager } from '../../test-utils/in-memory-storage.js';
import { createLogger } from '../../logger/factory.js';
import type { ModelMessage } from 'ai';
import type { LanguageModel } from 'ai';
import type { ValidatedLLMConfig } from '../../llm/schemas.js';
import type { Logger } from '../../logger/v2/types.js';
import type { InternalMessage } from '../types.js';

// Only mock the AI SDK's generateText - everything else is real
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

/**
 * Integration tests for context compaction.
 *
 * These tests use real components (ContextManager, ReactiveOverflowStrategy, filterCompacted)
 * and only mock the LLM calls. This ensures the full compaction flow works correctly,
 * including the interaction between compaction and filterCompacted.
 */
describe('Context Compaction Integration Tests', () => {
    let contextManager: ContextManager<ModelMessage>;
    let compactionStrategy: ReactiveOverflowCompactionStrategy;
    let logger: Logger;
    let historyProvider: MemoryHistoryProvider;
    let storageManager: StorageManager;
    let mcpManager: MCPManager;
    let resourceManager: ResourceManager;

    const sessionId = 'compaction-test-session';

    beforeEach(async () => {
        vi.clearAllMocks();

        // Create real logger (quiet for tests)
        logger = createLogger({
            config: {
                level: 'warn',
                transports: [{ type: 'console', colorize: false }],
            },
            agentId: 'test-agent',
        });

        // Create real storage manager with in-memory backends
        storageManager = await createInMemoryStorageManager(logger);

        // Create real MCP and resource managers
        mcpManager = new MCPManager(logger);
        resourceManager = new ResourceManager(
            mcpManager,
            {
                internalResourcesConfig: { enabled: false, resources: [] },
                blobStore: storageManager.getBlobStore(),
            },
            logger
        );
        await resourceManager.initialize();

        // Create real history provider
        historyProvider = new MemoryHistoryProvider(logger);

        // Create real memory and system prompt managers
        const memoryManager = new MemoryManager(storageManager.getDatabase(), logger);
        const systemPromptConfig = SystemPromptConfigSchema.parse('You are a helpful assistant.');
        const systemPromptManager = new SystemPromptManager(
            systemPromptConfig,
            memoryManager,
            undefined,
            logger
        );

        // Create real context manager
        const formatter = new VercelMessageFormatter(logger);
        const llmConfig = {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'test-api-key',
            maxInputTokens: 100000,
            maxOutputTokens: 4096,
        } as unknown as ValidatedLLMConfig;

        contextManager = new ContextManager<ModelMessage>(
            llmConfig,
            formatter,
            systemPromptManager,
            100000,
            historyProvider,
            sessionId,
            resourceManager,
            logger
        );

        // Create real compaction strategy
        compactionStrategy = new ReactiveOverflowCompactionStrategy({});

        // Default mock for generateText (compaction summary)
        mockGenerateText.mockResolvedValue({
            text: '<session_compaction>Summary of conversation</session_compaction>',
        } as Awaited<ReturnType<typeof generateText>>);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        logger.destroy();
    });

    /**
     * Helper to add a batch of messages to the context
     */
    async function addMessages(count: number): Promise<void> {
        for (let i = 0; i < count; i++) {
            await contextManager.addUserMessage([{ type: 'text', text: `Question ${i}` }]);
            await contextManager.addAssistantMessage(`Answer ${i}`);
        }
    }

    /**
     * Helper to run compaction and add result to history
     */
    async function runCompaction(): Promise<InternalMessage | null> {
        const history = await contextManager.getHistory();
        const summaryMessages = await compactionStrategy.compact(history, {
            sessionId,
            model: createMockModel(),
            logger,
        });

        if (summaryMessages.length === 0) {
            return null;
        }

        const summary = summaryMessages[0]!;
        await contextManager.addMessage(summary);
        return summary;
    }

    describe('Single Compaction', () => {
        it('should compact history and filterCompacted should return correct messages', async () => {
            // Add 20 messages (10 turns)
            await addMessages(10);

            const historyBefore = await contextManager.getHistory();
            expect(historyBefore).toHaveLength(20);

            // Run compaction
            const summary = await runCompaction();
            expect(summary).not.toBeNull();
            expect(summary?.metadata?.isSummary).toBe(true);

            // Verify history grew by 1 (summary added)
            const historyAfter = await contextManager.getHistory();
            expect(historyAfter).toHaveLength(21);

            // filterCompacted should return much fewer messages
            const filtered = filterCompacted(historyAfter);
            expect(filtered.length).toBeLessThan(historyAfter.length);
            expect(filtered[0]?.metadata?.isSummary).toBe(true);

            // Preserved messages should be non-summary messages
            const nonSummaryMessages = filtered.filter((m) => !m.metadata?.isSummary);
            expect(nonSummaryMessages.length).toBeGreaterThan(0);
            expect(nonSummaryMessages.length).toBeLessThan(10); // Some were summarized
        });
    });

    describe('Multiple Sequential Compactions', () => {
        it('should handle two compactions correctly', async () => {
            // === FIRST COMPACTION ===
            await addMessages(10);
            const summary1 = await runCompaction();
            expect(summary1).not.toBeNull();
            expect(summary1?.metadata?.isRecompaction).toBeUndefined();

            const historyAfter1 = await contextManager.getHistory();
            // Verify first compaction produced fewer filtered messages
            const filtered1 = filterCompacted(historyAfter1);
            expect(filtered1.length).toBeLessThan(historyAfter1.length);

            // === ADD MORE MESSAGES ===
            await addMessages(10);

            const historyBefore2 = await contextManager.getHistory();
            // 21 (after first compaction) + 20 new = 41
            expect(historyBefore2).toHaveLength(41);

            // === SECOND COMPACTION ===
            const summary2 = await runCompaction();
            expect(summary2).not.toBeNull();
            expect(summary2?.metadata?.isRecompaction).toBe(true);

            const historyAfter2 = await contextManager.getHistory();
            expect(historyAfter2).toHaveLength(42);

            const filtered2 = filterCompacted(historyAfter2);

            // Critical: second compaction should result in FEWER filtered messages
            // (or at least not significantly more)
            expect(filtered2.length).toBeLessThan(30);

            // Only the most recent summary should be in filtered result
            const summariesInFiltered = filtered2.filter((m) => m.metadata?.isSummary);
            expect(summariesInFiltered).toHaveLength(1);
            expect(summariesInFiltered[0]?.metadata?.isRecompaction).toBe(true);

            // The first summary should NOT be in filtered result
            expect(filtered2).not.toContain(summary1);
        });

        it('should handle three compactions correctly', async () => {
            // === FIRST COMPACTION ===
            await addMessages(10);
            const summary1 = await runCompaction();
            expect(summary1).not.toBeNull();

            // === SECOND COMPACTION ===
            await addMessages(10);
            const summary2 = await runCompaction();
            expect(summary2).not.toBeNull();
            expect(summary2?.metadata?.isRecompaction).toBe(true);

            // === THIRD COMPACTION ===
            await addMessages(10);
            const summary3 = await runCompaction();
            expect(summary3).not.toBeNull();
            expect(summary3?.metadata?.isRecompaction).toBe(true);

            // Verify final state
            const historyFinal = await contextManager.getHistory();
            // 20 + 1 + 20 + 1 + 20 + 1 = 63
            expect(historyFinal).toHaveLength(63);

            const filteredFinal = filterCompacted(historyFinal);

            // Critical assertions:
            // 1. Only the most recent summary should be visible
            const summariesInFiltered = filteredFinal.filter((m) => m.metadata?.isSummary);
            expect(summariesInFiltered).toHaveLength(1);
            expect(summariesInFiltered[0]).toBe(summary3);

            // 2. Neither summary1 nor summary2 should be in the result
            expect(filteredFinal).not.toContain(summary1);
            expect(filteredFinal).not.toContain(summary2);

            // 3. Filtered result should be much smaller than full history
            expect(filteredFinal.length).toBeLessThan(20);

            // 4. Preserved messages should exist and be reasonable count
            const nonSummaryMessages = filteredFinal.filter((m) => !m.metadata?.isSummary);
            expect(nonSummaryMessages.length).toBeGreaterThan(0);
            expect(nonSummaryMessages.length).toBeLessThan(15);
        });

        it('should correctly calculate originalMessageCount for each compaction', async () => {
            // === FIRST COMPACTION ===
            await addMessages(10);
            const summary1 = await runCompaction();
            expect(summary1).not.toBeNull();

            // First compaction: originalMessageCount should be the number of summarized messages
            const originalCount1 = summary1?.metadata?.originalMessageCount;
            expect(typeof originalCount1).toBe('number');
            expect(originalCount1).toBeLessThan(20); // Less than total, some were preserved

            // === SECOND COMPACTION ===
            await addMessages(10);
            const historyBefore2 = await contextManager.getHistory();
            const summary1Index = historyBefore2.findIndex((m) => m === summary1);

            const summary2 = await runCompaction();
            expect(summary2).not.toBeNull();

            // Second compaction: originalMessageCount should be ABSOLUTE
            // It should be > summary1Index (pointing past the first summary)
            const originalCount2 = summary2?.metadata?.originalMessageCount;
            expect(typeof originalCount2).toBe('number');
            expect(originalCount2).toBeGreaterThan(summary1Index);

            // Verify filterCompacted works with this absolute count
            const historyAfter2 = await contextManager.getHistory();
            const filtered2 = filterCompacted(historyAfter2);

            // The filtered result should NOT include summary1
            expect(filtered2).not.toContain(summary1);
            // Preserved messages should exist
            const preserved = filtered2.filter((m) => !m.metadata?.isSummary);
            expect(preserved.length).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        it('should not compact if history is too short', async () => {
            await addMessages(1); // Only 2 messages

            const summary = await runCompaction();
            expect(summary).toBeNull();
        });

        it('should not re-compact if few messages after existing summary', async () => {
            // First compaction
            await addMessages(10);
            await runCompaction();

            // Add only 2 messages (4 messages = 2 turns, below threshold)
            await addMessages(2);

            // Should skip re-compaction
            const summary2 = await runCompaction();
            expect(summary2).toBeNull();
        });

        it('should handle compaction through prepareHistory flow', async () => {
            // This tests the real integration with ContextManager.prepareHistory()
            // which is what's used when formatting messages for LLM

            await addMessages(10);
            await runCompaction();
            await addMessages(10);
            await runCompaction();

            // prepareHistory uses filterCompacted internally
            const { preparedHistory, stats } = await contextManager.prepareHistory();

            // Stats should reflect the filtered counts
            expect(stats.filteredCount).toBeLessThan(stats.originalCount);

            // preparedHistory should only contain filtered messages
            const summaries = preparedHistory.filter((m) => m.metadata?.isSummary);
            expect(summaries).toHaveLength(1);
        });
    });

    describe('Token Estimation After Compaction', () => {
        it('should provide accurate token estimates after compaction', async () => {
            await addMessages(10);

            // Get estimate before compaction
            const estimateBefore = await contextManager.getContextTokenEstimate({ mcpManager }, {});
            const messagesBefore = estimateBefore.stats.filteredMessageCount;

            // Run compaction
            await runCompaction();
            contextManager.resetActualTokenTracking();

            // Get estimate after compaction
            const estimateAfter = await contextManager.getContextTokenEstimate({ mcpManager }, {});
            const messagesAfter = estimateAfter.stats.filteredMessageCount;

            // After compaction, should have fewer messages
            expect(messagesAfter).toBeLessThan(messagesBefore);
        });

        it('should maintain consistency between /context and compaction stats', async () => {
            await addMessages(10);
            await runCompaction();
            await addMessages(10);
            await runCompaction();

            // This is what /context command uses
            const estimate = await contextManager.getContextTokenEstimate({ mcpManager }, {});

            // The filteredMessageCount should match what filterCompacted returns
            const history = await contextManager.getHistory();
            const filtered = filterCompacted(history);

            expect(estimate.stats.filteredMessageCount).toBe(filtered.length);
            expect(estimate.stats.originalMessageCount).toBe(history.length);
        });
    });
});
