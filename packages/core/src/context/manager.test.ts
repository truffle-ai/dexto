import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from './manager.js';
import { MemoryHistoryProvider } from '../session/history/memory.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import type { ContentPart, SanitizedToolResult } from './types.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { VercelMessageFormatter } from '../llm/formatters/vercel.js';
import type { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { BlobStore } from '../storage/blob/types.js';

// Create mock dependencies
const mockLogger = createMockLogger();

function createMockLLMConfig(): ValidatedLLMConfig {
    return {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
        maxIterations: 10,
    } as ValidatedLLMConfig;
}

function createMockFormatter(): VercelMessageFormatter {
    return {
        format: vi.fn().mockReturnValue([]),
        formatSystemPrompt: vi.fn().mockReturnValue(null),
    } as unknown as VercelMessageFormatter;
}

function createMockSystemPromptManager(): SystemPromptManager {
    return {
        build: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    } as unknown as SystemPromptManager;
}

function createMockBlobStore(): BlobStore {
    return {
        store: vi.fn(),
        retrieve: vi.fn(),
        exists: vi.fn(),
        delete: vi.fn(),
        cleanup: vi.fn(),
        getStats: vi.fn(),
        listBlobs: vi.fn(),
        getStoragePath: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
        getStoreType: vi.fn().mockReturnValue('mock'),
    } as unknown as BlobStore;
}

function createMockResourceManager(): ResourceManager {
    const mockBlobStore = createMockBlobStore();
    return {
        read: vi.fn(),
        getBlobStore: vi.fn().mockReturnValue(mockBlobStore),
    } as unknown as ResourceManager;
}

function createContextManager() {
    const historyProvider = new MemoryHistoryProvider(mockLogger);
    const formatter = createMockFormatter();
    const systemPromptManager = createMockSystemPromptManager();
    const resourceManager = createMockResourceManager();
    const llmConfig = createMockLLMConfig();

    return new ContextManager(
        llmConfig,
        formatter,
        systemPromptManager,
        4096, // maxInputTokens
        historyProvider,
        'test-session-id',
        resourceManager,
        mockLogger
    );
}

describe('ContextManager', () => {
    let contextManager: ContextManager;

    beforeEach(() => {
        vi.clearAllMocks();
        contextManager = createContextManager();
    });

    describe('addUserMessage', () => {
        it('should add a user message with text content', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'Hello, world!' }];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.role).toBe('user');
            expect(history[0]?.content).toEqual([{ type: 'text', text: 'Hello, world!' }]);
        });

        it('should add a user message with multiple text parts', async () => {
            const content: ContentPart[] = [
                { type: 'text', text: 'First part' },
                { type: 'text', text: 'Second part' },
            ];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.content).toHaveLength(2);
        });

        it('should add a user message with image content', async () => {
            const content: ContentPart[] = [
                { type: 'text', text: 'Check this image' },
                { type: 'image', image: 'base64data', mimeType: 'image/png' },
            ];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.content).toHaveLength(2);
            const imagePart = (history[0]?.content as ContentPart[])?.[1];
            expect(imagePart?.type).toBe('image');
        });

        it('should add a user message with file content', async () => {
            const content: ContentPart[] = [
                { type: 'text', text: 'Here is a file' },
                {
                    type: 'file',
                    data: 'filedata',
                    mimeType: 'application/pdf',
                    filename: 'doc.pdf',
                },
            ];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            const filePart = (history[0]?.content as ContentPart[])?.[1];
            expect(filePart?.type).toBe('file');
        });

        it('should throw error for empty content array', async () => {
            await expect(contextManager.addUserMessage([])).rejects.toThrow();
        });

        it('should throw error for content with only whitespace text', async () => {
            const content: ContentPart[] = [{ type: 'text', text: '   ' }];

            await expect(contextManager.addUserMessage(content)).rejects.toThrow();
        });

        it('should allow empty text with image attachment', async () => {
            const content: ContentPart[] = [
                { type: 'text', text: '' },
                { type: 'image', image: 'base64data', mimeType: 'image/png' },
            ];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            // Empty text parts are filtered out, only image remains
            expect((history[0]?.content as ContentPart[])?.some((p) => p.type === 'image')).toBe(
                true
            );
        });

        it('should generate message id and timestamp', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'Hello' }];

            await contextManager.addUserMessage(content);

            const history = await contextManager.getHistory();
            expect(history[0]?.id).toBeDefined();
            expect(history[0]?.timestamp).toBeDefined();
            expect(typeof history[0]?.id).toBe('string');
            expect(typeof history[0]?.timestamp).toBe('number');
        });
    });

    describe('addAssistantMessage', () => {
        it('should add an assistant message with string content', async () => {
            await contextManager.addAssistantMessage('Hello from assistant');

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.role).toBe('assistant');
            // String content should be wrapped in ContentPart[]
            expect(history[0]?.content).toEqual([{ type: 'text', text: 'Hello from assistant' }]);
        });

        it('should add an assistant message with null content and tool calls', async () => {
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                },
            ];

            await contextManager.addAssistantMessage(null, toolCalls);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.role).toBe('assistant');
            expect(history[0]?.content).toBeNull();
            expect((history[0] as any).toolCalls).toHaveLength(1);
        });

        it('should add an assistant message with content and tool calls', async () => {
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                },
            ];

            await contextManager.addAssistantMessage('Let me help', toolCalls);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.content).toEqual([{ type: 'text', text: 'Let me help' }]);
            expect((history[0] as any).toolCalls).toHaveLength(1);
        });

        it('should throw error when neither content nor tool calls provided', async () => {
            await expect(contextManager.addAssistantMessage(null, [])).rejects.toThrow();
            await expect(contextManager.addAssistantMessage(null, undefined)).rejects.toThrow();
        });

        it('should include token usage metadata', async () => {
            const tokenUsage = {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            };

            await contextManager.addAssistantMessage('Response', undefined, { tokenUsage });

            const history = await contextManager.getHistory();
            expect((history[0] as any).tokenUsage).toEqual(tokenUsage);
        });

        it('should include reasoning metadata', async () => {
            await contextManager.addAssistantMessage('Response', undefined, {
                reasoning: 'I thought about this carefully',
            });

            const history = await contextManager.getHistory();
            expect((history[0] as any).reasoning).toBe('I thought about this carefully');
        });

        it('should enrich with provider and model from config', async () => {
            await contextManager.addAssistantMessage('Response');

            const history = await contextManager.getHistory();
            expect((history[0] as any).provider).toBe('openai');
            expect((history[0] as any).model).toBe('gpt-4');
        });
    });

    describe('appendAssistantText', () => {
        it('should append text to existing assistant message with null content', async () => {
            // First add an assistant message with tool calls only (null content)
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                },
            ];
            await contextManager.addAssistantMessage(null, toolCalls);

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            // Append text
            await contextManager.appendAssistantText(messageId, 'New text');

            const updatedHistory = await contextManager.getHistory();
            expect(updatedHistory[0]?.content).toEqual([{ type: 'text', text: 'New text' }]);
        });

        it('should append text to existing text part', async () => {
            await contextManager.addAssistantMessage('Initial');

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            await contextManager.appendAssistantText(messageId, ' appended');

            const updatedHistory = await contextManager.getHistory();
            expect(updatedHistory[0]?.content).toEqual([
                { type: 'text', text: 'Initial appended' },
            ]);
        });

        it('should throw error for non-existent message', async () => {
            await expect(
                contextManager.appendAssistantText('non-existent-id', 'text')
            ).rejects.toThrow();
        });

        it('should throw error for non-assistant message', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'User message' }]);

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            await expect(contextManager.appendAssistantText(messageId, 'text')).rejects.toThrow();
        });
    });

    describe('addToolResult', () => {
        it('should add a tool result message', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Tool output' }],
                meta: {
                    toolName: 'test_tool',
                    toolCallId: 'call-123',
                    success: true,
                },
            };

            await contextManager.addToolResult('call-123', 'test_tool', sanitizedResult);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]?.role).toBe('tool');
            expect(history[0]?.content).toEqual([{ type: 'text', text: 'Tool output' }]);
            expect((history[0] as any).toolCallId).toBe('call-123');
            expect((history[0] as any).name).toBe('test_tool');
            expect((history[0] as any).success).toBe(true);
        });

        it('should add a tool result with image content', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [
                    { type: 'text', text: 'Here is the screenshot' },
                    { type: 'image', image: 'base64screenshot', mimeType: 'image/png' },
                ],
                meta: {
                    toolName: 'screenshot_tool',
                    toolCallId: 'call-456',
                    success: true,
                },
            };

            await contextManager.addToolResult('call-456', 'screenshot_tool', sanitizedResult);

            const history = await contextManager.getHistory();
            expect(history[0]?.content).toHaveLength(2);
        });

        it('should add a failed tool result', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Error: Tool failed' }],
                meta: {
                    toolName: 'failing_tool',
                    toolCallId: 'call-789',
                    success: false,
                },
            };

            await contextManager.addToolResult('call-789', 'failing_tool', sanitizedResult);

            const history = await contextManager.getHistory();
            expect((history[0] as any).success).toBe(false);
        });

        it('should include approval metadata', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Approved result' }],
                meta: {
                    toolName: 'dangerous_tool',
                    toolCallId: 'call-approved',
                    success: true,
                },
            };

            await contextManager.addToolResult('call-approved', 'dangerous_tool', sanitizedResult, {
                requireApproval: true,
                approvalStatus: 'approved',
            });

            const history = await contextManager.getHistory();
            expect((history[0] as any).requireApproval).toBe(true);
            expect((history[0] as any).approvalStatus).toBe('approved');
        });

        it('should throw error when toolCallId is missing', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Output' }],
                meta: {
                    toolName: 'test_tool',
                    toolCallId: 'call-123',
                    success: true,
                },
            };

            await expect(
                contextManager.addToolResult('', 'test_tool', sanitizedResult)
            ).rejects.toThrow();
        });

        it('should throw error when name is missing', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Output' }],
                meta: {
                    toolName: 'test_tool',
                    toolCallId: 'call-123',
                    success: true,
                },
            };

            await expect(
                contextManager.addToolResult('call-123', '', sanitizedResult)
            ).rejects.toThrow();
        });
    });

    describe('getHistory', () => {
        it('should return empty array initially', async () => {
            const history = await contextManager.getHistory();
            expect(history).toEqual([]);
        });

        it('should return all messages in order', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'User 1' }]);
            await contextManager.addAssistantMessage('Assistant 1');
            await contextManager.addUserMessage([{ type: 'text', text: 'User 2' }]);

            const history = await contextManager.getHistory();
            expect(history).toHaveLength(3);
            expect(history[0]?.role).toBe('user');
            expect(history[1]?.role).toBe('assistant');
            expect(history[2]?.role).toBe('user');
        });

        it('should return defensive copy', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const history1 = await contextManager.getHistory();
            const history2 = await contextManager.getHistory();

            expect(history1).not.toBe(history2);
            expect(history1).toEqual(history2);
        });
    });

    describe('resetConversation', () => {
        it('should clear all messages', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.addAssistantMessage('Hi');

            let history = await contextManager.getHistory();
            expect(history).toHaveLength(2);

            await contextManager.resetConversation();

            history = await contextManager.getHistory();
            expect(history).toEqual([]);
        });
    });

    describe('markMessagesAsCompacted', () => {
        it('should mark tool messages as compacted', async () => {
            // Add a tool result
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Tool output' }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', sanitizedResult);

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            const count = await contextManager.markMessagesAsCompacted([messageId]);

            expect(count).toBe(1);
            const updatedHistory = await contextManager.getHistory();
            expect((updatedHistory[0] as any).compactedAt).toBeDefined();
        });

        it('should not mark non-tool messages', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            const count = await contextManager.markMessagesAsCompacted([messageId]);

            expect(count).toBe(0);
        });

        it('should skip already compacted messages', async () => {
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Tool output' }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', sanitizedResult);

            const history = await contextManager.getHistory();
            const messageId = history[0]?.id!;

            // Mark once
            await contextManager.markMessagesAsCompacted([messageId]);
            // Mark again
            const count = await contextManager.markMessagesAsCompacted([messageId]);

            expect(count).toBe(0);
        });

        it('should return 0 for empty array', async () => {
            const count = await contextManager.markMessagesAsCompacted([]);
            expect(count).toBe(0);
        });
    });

    describe('lastActualInputTokens', () => {
        it('should return null initially and store/update values', () => {
            expect(contextManager.getLastActualInputTokens()).toBeNull();

            contextManager.setLastActualInputTokens(5000);
            expect(contextManager.getLastActualInputTokens()).toBe(5000);

            contextManager.setLastActualInputTokens(7500);
            expect(contextManager.getLastActualInputTokens()).toBe(7500);
        });
    });

    describe('prepareHistory', () => {
        it('should transform pruned tool messages to placeholders', async () => {
            // Add a tool result with known content
            const originalContent = 'This is a long tool output that will be pruned';
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: originalContent }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', sanitizedResult);

            // Mark it as compacted (pruned)
            const history = await contextManager.getHistory();
            const toolMessageId = history.find((m) => m.role === 'tool')?.id;
            expect(toolMessageId).toBeDefined();
            await contextManager.markMessagesAsCompacted([toolMessageId!]);

            const result = await contextManager.prepareHistory();

            // Verify transformation happened
            expect(result.stats.prunedToolCount).toBe(1);
            const toolMsg = result.preparedHistory.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toEqual([
                { type: 'text', text: '[Old tool result content cleared]' },
            ]);

            // Verify original content is NOT in prepared history
            const toolMsgText = (toolMsg?.content as any)?.[0]?.text;
            expect(toolMsgText).not.toContain(originalContent);
        });

        it('should not transform non-pruned tool messages', async () => {
            const originalContent = 'This tool output should remain intact';
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: originalContent }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', sanitizedResult);

            // Don't mark as compacted
            const result = await contextManager.prepareHistory();

            expect(result.stats.prunedToolCount).toBe(0);
            const toolMsg = result.preparedHistory.find((m) => m.role === 'tool');
            expect((toolMsg?.content as any)?.[0]?.text).toBe(originalContent);
        });
    });

    describe('getContextTokenEstimate', () => {
        const mockContributorContext = { mcpManager: {} as any };
        const mockTools = {
            'test-tool': {
                name: 'test-tool',
                description: 'A test tool',
                parameters: { type: 'object', properties: {} },
            },
        };

        it('should calculate total as sum of breakdown components', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            const result = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            const calculatedTotal =
                result.breakdown.systemPrompt +
                result.breakdown.tools.total +
                result.breakdown.messages;

            expect(result.estimated).toBe(calculatedTotal);
            expect(result.actual).toBeNull(); // No LLM call made
        });

        it('should return actual tokens when set', async () => {
            contextManager.setLastActualInputTokens(12500);

            const result = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            expect(result.actual).toBe(12500);
        });

        it('should reduce estimate when tool messages are pruned', async () => {
            // Add a tool result with substantial content (~250 tokens)
            const sanitizedResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'A'.repeat(1000) }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', sanitizedResult);

            const beforePrune = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Mark the tool message as compacted
            const history = await contextManager.getHistory();
            const toolMessageId = history.find((m) => m.role === 'tool')?.id;
            await contextManager.markMessagesAsCompacted([toolMessageId!]);

            const afterPrune = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Estimate should be significantly lower (placeholder ~10 tokens vs ~250)
            expect(afterPrune.breakdown.messages).toBeLessThan(beforePrune.breakdown.messages);
            expect(beforePrune.breakdown.messages - afterPrune.breakdown.messages).toBeGreaterThan(
                200
            );
            expect(afterPrune.stats.prunedToolCount).toBe(1);
        });

        it('should use actuals-based formula when all actuals are available', async () => {
            // Add initial message
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Simulate LLM call completing - set all actuals
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            await contextManager.recordLastCallMessageCount();

            // Add assistant response (simulating what happens after LLM call)
            await contextManager.addAssistantMessage('Hi there!', []);

            // Add a "new" message (tool result)
            const toolResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Tool output here' }],
                meta: { toolName: 'test', toolCallId: 'call-1', success: true },
            };
            await contextManager.addToolResult('call-1', 'test', toolResult);

            const result = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should have calculationBasis with method 'actuals'
            expect(result.calculationBasis).toBeDefined();
            expect(result.calculationBasis?.method).toBe('actuals');
            expect(result.calculationBasis?.lastInputTokens).toBe(5000);
            expect(result.calculationBasis?.lastOutputTokens).toBe(200);
            expect(result.calculationBasis?.newMessagesEstimate).toBeGreaterThan(0);

            // The estimated total should be: lastInput + lastOutput + newMessagesEstimate
            const expectedTotal = 5000 + 200 + (result.calculationBasis?.newMessagesEstimate ?? 0);
            expect(result.estimated).toBe(expectedTotal);
        });

        it('should fall back to pure estimation when actuals not available', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Don't set any actuals
            const result = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should have calculationBasis with method 'estimate'
            expect(result.calculationBasis).toBeDefined();
            expect(result.calculationBasis?.method).toBe('estimate');
            expect(result.calculationBasis?.lastInputTokens).toBeUndefined();
            expect(result.calculationBasis?.lastOutputTokens).toBeUndefined();
        });
    });

    describe('lastActualOutputTokens', () => {
        it('should return null initially and store/update values', () => {
            expect(contextManager.getLastActualOutputTokens()).toBeNull();

            contextManager.setLastActualOutputTokens(300);
            expect(contextManager.getLastActualOutputTokens()).toBe(300);

            contextManager.setLastActualOutputTokens(500);
            expect(contextManager.getLastActualOutputTokens()).toBe(500);
        });
    });

    describe('lastCallMessageCount', () => {
        it('should return null initially', () => {
            expect(contextManager.getLastCallMessageCount()).toBeNull();
        });

        it('should record current history length', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.addAssistantMessage('Hi!', []);

            await contextManager.recordLastCallMessageCount();

            expect(contextManager.getLastCallMessageCount()).toBe(2);
        });

        it('should update when new messages are added and recorded again', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.recordLastCallMessageCount();
            expect(contextManager.getLastCallMessageCount()).toBe(1);

            await contextManager.addAssistantMessage('Hi!', []);
            await contextManager.recordLastCallMessageCount();
            expect(contextManager.getLastCallMessageCount()).toBe(2);
        });
    });

    describe('resetActualTokenTracking', () => {
        it('should reset all tracking values to null', async () => {
            // Set all values
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(300);
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.recordLastCallMessageCount();

            // Verify they're set
            expect(contextManager.getLastActualInputTokens()).toBe(5000);
            expect(contextManager.getLastActualOutputTokens()).toBe(300);
            expect(contextManager.getLastCallMessageCount()).toBe(1);

            // Reset
            contextManager.resetActualTokenTracking();

            // Verify all are null
            expect(contextManager.getLastActualInputTokens()).toBeNull();
            expect(contextManager.getLastActualOutputTokens()).toBeNull();
            expect(contextManager.getLastCallMessageCount()).toBeNull();
        });

        it('should cause estimation to fall back to pure estimation', async () => {
            const mockContributorContext = { mcpManager: {} as any };
            const mockTools = {};

            // Set actuals
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            await contextManager.recordLastCallMessageCount();

            // Verify actuals-based method
            const beforeReset = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(beforeReset.calculationBasis?.method).toBe('actuals');

            // Reset
            contextManager.resetActualTokenTracking();

            // Verify fallback to pure estimation
            const afterReset = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(afterReset.calculationBasis?.method).toBe('estimate');
        });
    });

    describe('getEstimatedNextInputTokens', () => {
        const mockTools = {
            'test-tool': {
                name: 'test-tool',
                description: 'A test tool',
                parameters: { type: 'object', properties: {} },
            },
        };

        it('should calculate formula exactly: lastInput + lastOutput + newMessagesEstimate', async () => {
            // Setup: one message BEFORE recording
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Simulate LLM call: set actuals and record boundary
            const LAST_INPUT = 5000;
            const LAST_OUTPUT = 200;
            contextManager.setLastActualInputTokens(LAST_INPUT);
            contextManager.setLastActualOutputTokens(LAST_OUTPUT);
            await contextManager.recordLastCallMessageCount(); // count = 1

            // Add NEW messages after the boundary (these are the "new" messages)
            // Use a known string length so we can predict token estimate
            const newMessageText = 'A'.repeat(400); // ~100 tokens with length/4 heuristic
            await contextManager.addAssistantMessage(newMessageText, []);

            const { preparedHistory } = await contextManager.prepareHistory();
            const systemPrompt = 'System';

            const estimated = await contextManager.getEstimatedNextInputTokens(
                systemPrompt,
                preparedHistory,
                mockTools
            );

            // Get the actual newMessagesEstimate by checking the raw history
            const history = await contextManager.getHistory();
            const newMessages = history.slice(1); // slice from lastCallMessageCount (1)
            expect(newMessages.length).toBe(1); // Just the assistant message we added

            // The formula should be: LAST_INPUT + LAST_OUTPUT + newMessagesEstimate
            // We can verify the formula is applied by checking the result is exactly this
            const { estimateMessagesTokens } = await import('./utils.js');
            const expectedNewEstimate = estimateMessagesTokens(newMessages);
            const expectedTotal = LAST_INPUT + LAST_OUTPUT + expectedNewEstimate;

            expect(estimated).toBe(expectedTotal);
        });

        it('should only count messages AFTER lastCallMessageCount as new', async () => {
            // Add messages BEFORE recording
            await contextManager.addUserMessage([{ type: 'text', text: 'Message 1' }]);
            await contextManager.addAssistantMessage('Response 1', []);

            // Record boundary at 2 messages
            contextManager.setLastActualInputTokens(10000);
            contextManager.setLastActualOutputTokens(500);
            await contextManager.recordLastCallMessageCount();
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            // Add messages AFTER recording - these should be the only "new" messages
            await contextManager.addUserMessage([{ type: 'text', text: 'Message 2' }]);

            const { preparedHistory } = await contextManager.prepareHistory();
            const systemPrompt = 'System';

            // Get estimate with actuals
            const estimated = await contextManager.getEstimatedNextInputTokens(
                systemPrompt,
                preparedHistory,
                mockTools
            );

            // Verify by calculating expected value
            const history = await contextManager.getHistory();
            expect(history.length).toBe(3); // 2 before + 1 after

            const newMessages = history.slice(2); // Only messages after lastCallMessageCount
            expect(newMessages.length).toBe(1); // Just "Message 2"

            const { estimateMessagesTokens } = await import('./utils.js');
            const newEstimate = estimateMessagesTokens(newMessages);
            const expectedTotal = 10000 + 500 + newEstimate;

            expect(estimated).toBe(expectedTotal);
        });

        it('should return zero newMessagesEstimate when no new messages', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Record boundary at current history length
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            await contextManager.recordLastCallMessageCount();

            // Don't add any new messages

            const { preparedHistory } = await contextManager.prepareHistory();
            const systemPrompt = 'System';

            const estimated = await contextManager.getEstimatedNextInputTokens(
                systemPrompt,
                preparedHistory,
                mockTools
            );

            // Should be exactly lastInput + lastOutput + 0
            expect(estimated).toBe(5000 + 200);
        });

        it('should fall back to pure estimation when only lastInput is set', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Only set lastInput, not lastOutput or lastCallMessageCount
            contextManager.setLastActualInputTokens(5000);
            // lastOutput is null, lastCallMessageCount is null

            const mockContributorContext = { mcpManager: {} as any };

            // Should fall back to pure estimation since not all actuals are set
            const fullEstimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Verify it's using pure estimation (not actuals-based)
            expect(fullEstimate.calculationBasis?.method).toBe('estimate');

            // The estimated value should NOT be based on the lastInput we set (5000)
            // It should be a pure estimate based on system + tools + messages
            // If it were using actuals, it would be much larger (5000 + something)
            expect(fullEstimate.estimated).toBeLessThan(1000); // Pure estimate of small message
        });

        it('should fall back to pure estimation when lastCallMessageCount is null', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);

            // Set input and output but NOT message count
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            // Don't call recordLastCallMessageCount()

            const mockContributorContext = { mcpManager: {} as any };

            const fullEstimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should fall back to pure estimation
            expect(fullEstimate.calculationBasis?.method).toBe('estimate');
        });

        it('should return same result as getContextTokenEstimate for consistency', async () => {
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            await contextManager.recordLastCallMessageCount();

            const { preparedHistory } = await contextManager.prepareHistory();
            const systemPrompt = 'You are a helpful assistant.';
            const mockContributorContext = { mcpManager: {} as any };

            const estimatedViaMethod = await contextManager.getEstimatedNextInputTokens(
                systemPrompt,
                preparedHistory,
                mockTools
            );

            const fullEstimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Both should use the same formula and return the same total
            expect(estimatedViaMethod).toBe(fullEstimate.estimated);
            expect(fullEstimate.calculationBasis?.method).toBe('actuals');
        });

        it('should include all messages since last successful call when tracking is not updated (cancellation scenario)', async () => {
            // Scenario: User sends message, LLM responds successfully, then user sends another
            // message but the LLM call gets cancelled. On cancellation, we don't update tracking.
            // The next estimate should include all content since the last successful call.
            //
            // In real execution, the sequence is:
            // 1. User message added to history
            // 2. LLM stream starts, assistant message added on first delta
            // 3. Stream finishes with usage data
            // 4. We set lastInputTokens, lastOutputTokens
            // 5. We call recordLastCallMessageCount() - captures count AFTER assistant is added
            //
            // So the boundary is set AFTER the assistant response, not before.

            // === Successful call 1 ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            // Assistant response added during stream (before we record)
            await contextManager.addAssistantMessage('Hi there! How can I help?', []);
            // Now we record tracking (simulating what happens after stream completes)
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(200);
            await contextManager.recordLastCallMessageCount(); // boundary = 2 (user1 + assistant1)

            // Get estimate after successful call - should have zero newMessagesEstimate
            const mockContributorContext = { mcpManager: {} as any };
            const estimateAfterSuccess = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // newMessagesEstimate should be 0 - no messages after boundary
            expect(estimateAfterSuccess.calculationBasis?.newMessagesEstimate).toBe(0);
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            // === Cancelled call 2 ===
            // User sends new message
            await contextManager.addUserMessage([
                { type: 'text', text: 'Tell me a long story about dragons' },
            ]);

            // Partial assistant response gets saved to history (what happens on cancel)
            await contextManager.addAssistantMessage(
                'Once upon a time, in a land far away, there lived a magnificent dragon...',
                []
            );

            // IMPORTANT: On cancellation, we do NOT update tracking:
            // - No setLastActualInputTokens()
            // - No setLastActualOutputTokens()
            // - No recordLastCallMessageCount()

            // Get estimate after cancelled call
            const estimateAfterCancel = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should still use actuals-based method (from successful call 1)
            expect(estimateAfterCancel.calculationBasis?.method).toBe('actuals');
            expect(estimateAfterCancel.calculationBasis?.lastInputTokens).toBe(5000);
            expect(estimateAfterCancel.calculationBasis?.lastOutputTokens).toBe(200);

            // newMessagesEstimate should now include:
            // - User message from call 2
            // - Partial assistant response from cancelled call 2
            const afterCancelNewMsgs = estimateAfterCancel.calculationBasis?.newMessagesEstimate;
            expect(afterCancelNewMsgs).toBeDefined();
            expect(afterCancelNewMsgs!).toBeGreaterThan(0);

            // Verify the total estimate increased
            expect(estimateAfterCancel.estimated).toBeGreaterThan(estimateAfterSuccess.estimated);

            // Verify by checking history and expected new messages
            const history = await contextManager.getHistory();
            expect(history.length).toBe(4); // user1, assistant1, user2, assistant2-partial

            // lastCallMessageCount should still be 2 (from successful call)
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            // So newMessages should be history.slice(2) = [user2, assistant2-partial]
            const { estimateMessagesTokens } = await import('./utils.js');
            const expectedNewMessages = history.slice(2);
            expect(expectedNewMessages.length).toBe(2);
            const expectedNewEstimate = estimateMessagesTokens(expectedNewMessages);
            expect(afterCancelNewMsgs).toBe(expectedNewEstimate);
        });

        it('should accumulate multiple cancelled calls in newMessagesEstimate', async () => {
            // Scenario: Successful call, then 2 cancelled calls in a row
            // All cancelled content should accumulate in newMessagesEstimate

            // === Successful call ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Hi' }]);
            await contextManager.addAssistantMessage('Hello!', []); // Added during stream
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(100);
            await contextManager.recordLastCallMessageCount(); // boundary = 2 (after assistant added)

            // === Cancelled call 1 ===
            await contextManager.addUserMessage([
                { type: 'text', text: 'First cancelled request' },
            ]);
            await contextManager.addAssistantMessage('Starting to respond...', []);
            // No tracking update (cancelled)

            // === Cancelled call 2 ===
            await contextManager.addUserMessage([
                { type: 'text', text: 'Second cancelled request' },
            ]);
            await contextManager.addAssistantMessage('Another partial...', []);
            // No tracking update (cancelled)

            const mockContributorContext = { mcpManager: {} as any };
            const estimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should still use actuals from the one successful call
            expect(estimate.calculationBasis?.method).toBe('actuals');
            expect(estimate.calculationBasis?.lastInputTokens).toBe(5000);
            expect(estimate.calculationBasis?.lastOutputTokens).toBe(100);

            // History: [user1, assistant1, user2, assistant2-partial, user3, assistant3-partial]
            const history = await contextManager.getHistory();
            expect(history.length).toBe(6);
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            // newMessages = history.slice(2) = 4 messages from cancelled calls
            const { estimateMessagesTokens } = await import('./utils.js');
            const newMessages = history.slice(2);
            expect(newMessages.length).toBe(4);
            expect(estimate.calculationBasis?.newMessagesEstimate).toBe(
                estimateMessagesTokens(newMessages)
            );
        });

        it('should self-correct after successful call following cancellation', async () => {
            // Scenario: Success → Cancel → Success
            // The second success should provide fresh actuals

            // === Successful call 1 ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.addAssistantMessage('Hi!', []);
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(100);
            await contextManager.recordLastCallMessageCount(); // boundary = 2

            // === Cancelled call ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Tell me a story' }]);
            await contextManager.addAssistantMessage('Once upon a time...', []);
            // No tracking update

            // Verify we're estimating the cancelled content
            const mockContributorContext = { mcpManager: {} as any };
            const estimateAfterCancel = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(estimateAfterCancel.calculationBasis?.method).toBe('actuals');
            expect(estimateAfterCancel.calculationBasis?.lastInputTokens).toBe(5000);
            expect(estimateAfterCancel.calculationBasis?.newMessagesEstimate).toBeGreaterThan(0);

            // === Successful call 2 ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Just say hi' }]);
            await contextManager.addAssistantMessage('Hi again!', []);
            // This time we DO update tracking (successful call)
            contextManager.setLastActualInputTokens(5800); // Fresh actual from API
            contextManager.setLastActualOutputTokens(50);
            await contextManager.recordLastCallMessageCount(); // boundary = 6

            // Now estimate should use fresh actuals, newMessagesEstimate = 0
            const estimateAfterSuccess = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(estimateAfterSuccess.calculationBasis?.method).toBe('actuals');
            expect(estimateAfterSuccess.calculationBasis?.lastInputTokens).toBe(5800);
            expect(estimateAfterSuccess.calculationBasis?.lastOutputTokens).toBe(50);
            expect(estimateAfterSuccess.calculationBasis?.newMessagesEstimate).toBe(0);

            // History should have 6 messages, boundary at 6
            const history = await contextManager.getHistory();
            expect(history.length).toBe(6);
            expect(contextManager.getLastCallMessageCount()).toBe(6);
        });

        it('should fall back to pure estimation when first call is cancelled', async () => {
            // Scenario: Very first call gets cancelled, no prior actuals exist

            // === First call - cancelled ===
            await contextManager.addUserMessage([{ type: 'text', text: 'Hello' }]);
            await contextManager.addAssistantMessage('Hi...', []); // Partial response
            // No tracking update - all values remain null

            expect(contextManager.getLastActualInputTokens()).toBeNull();
            expect(contextManager.getLastActualOutputTokens()).toBeNull();
            expect(contextManager.getLastCallMessageCount()).toBeNull();

            const mockContributorContext = { mcpManager: {} as any };
            const estimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should fall back to pure estimation since no actuals available
            expect(estimate.calculationBasis?.method).toBe('estimate');
            expect(estimate.calculationBasis?.lastInputTokens).toBeUndefined();
            expect(estimate.calculationBasis?.lastOutputTokens).toBeUndefined();
        });

        it('should update tracking on each successful step in multi-step tool flow', async () => {
            // Scenario: LLM makes tool call (step 1), tool executes, LLM responds (step 2)
            // Tracking is updated after each step

            // === Step 1: User message, LLM calls tool ===
            await contextManager.addUserMessage([{ type: 'text', text: 'What is the weather?' }]);
            await contextManager.addAssistantMessage('', [
                {
                    id: 'tool-1',
                    type: 'function' as const,
                    function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
                },
            ]);
            // Step 1 completes with usage data
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(50);
            await contextManager.recordLastCallMessageCount(); // boundary = 2

            // Verify state after step 1
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            // === Tool executes, result added ===
            const toolResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Weather in NYC: Sunny, 72°F' }],
                meta: { toolName: 'get_weather', toolCallId: 'tool-1', success: true },
            };
            await contextManager.addToolResult('tool-1', 'get_weather', toolResult);

            // Before step 2, estimate should include tool result in newMessagesEstimate
            const mockContributorContext = { mcpManager: {} as any };
            const estimateBeforeStep2 = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(estimateBeforeStep2.calculationBasis?.method).toBe('actuals');
            expect(estimateBeforeStep2.calculationBasis?.newMessagesEstimate).toBeGreaterThan(0);

            // === Step 2: LLM responds with final answer ===
            await contextManager.addAssistantMessage('The weather in NYC is sunny and 72°F!', []);
            // Step 2 completes with fresh usage data
            contextManager.setLastActualInputTokens(5200); // Includes tool result now
            contextManager.setLastActualOutputTokens(30);
            await contextManager.recordLastCallMessageCount(); // boundary = 4

            // Verify state after step 2
            expect(contextManager.getLastCallMessageCount()).toBe(4);

            // After step 2, newMessagesEstimate should be 0
            const estimateAfterStep2 = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );
            expect(estimateAfterStep2.calculationBasis?.method).toBe('actuals');
            expect(estimateAfterStep2.calculationBasis?.lastInputTokens).toBe(5200);
            expect(estimateAfterStep2.calculationBasis?.lastOutputTokens).toBe(30);
            expect(estimateAfterStep2.calculationBasis?.newMessagesEstimate).toBe(0);

            // History should have 4 messages
            const history = await contextManager.getHistory();
            expect(history.length).toBe(4); // user, assistant-tool-call, tool-result, assistant-final
        });

        it('should handle tool call flow with cancellation during tool execution', async () => {
            // Scenario: LLM makes tool call, then cancelled before tool completes
            // Tool result is persisted as "cancelled"

            // === Step 1: LLM calls tool (successful step) ===
            await contextManager.addUserMessage([{ type: 'text', text: 'What is the weather?' }]);
            // Assistant message with tool call added during stream
            await contextManager.addAssistantMessage('', [
                {
                    id: 'tool-1',
                    type: 'function' as const,
                    function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
                },
            ]);
            // Step 1 completes with usage data
            contextManager.setLastActualInputTokens(5000);
            contextManager.setLastActualOutputTokens(50);
            await contextManager.recordLastCallMessageCount(); // boundary = 2

            // === Cancelled during tool execution ===
            // Tool result is added as "cancelled" by persistCancelledToolResults()
            const cancelledResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Cancelled by user' }],
                meta: { toolName: 'get_weather', toolCallId: 'tool-1', success: false },
            };
            await contextManager.addToolResult('tool-1', 'get_weather', cancelledResult);
            // No tracking update since overall turn was cancelled

            const mockContributorContext = { mcpManager: {} as any };
            const estimate = await contextManager.getContextTokenEstimate(
                mockContributorContext,
                mockTools
            );

            // Should use actuals from the successful tool-call step
            expect(estimate.calculationBasis?.method).toBe('actuals');
            expect(estimate.calculationBasis?.lastInputTokens).toBe(5000);
            expect(estimate.calculationBasis?.lastOutputTokens).toBe(50);

            // newMessagesEstimate should include the cancelled tool result
            const history = await contextManager.getHistory();
            expect(history.length).toBe(3); // user, assistant-tool-call, tool-result
            expect(contextManager.getLastCallMessageCount()).toBe(2);

            const { estimateMessagesTokens } = await import('./utils.js');
            const newMessages = history.slice(2); // Just the tool result
            expect(newMessages.length).toBe(1);
            expect(estimate.calculationBasis?.newMessagesEstimate).toBe(
                estimateMessagesTokens(newMessages)
            );
        });
    });
});
