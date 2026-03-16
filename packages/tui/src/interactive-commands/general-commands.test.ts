import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generalCommands } from './general-commands.js';
import { clearExitStats, getExitStats } from './exit-stats.js';

const { mockTriggerExit } = vi.hoisted(() => ({
    mockTriggerExit: vi.fn(),
}));

vi.mock('./exit-handler.js', () => ({
    triggerExit: mockTriggerExit,
}));

function getExitCommand() {
    const exitCommand = generalCommands.find((command) => command.name === 'exit');
    if (!exitCommand) {
        throw new Error('Exit command not found');
    }
    return exitCommand;
}

describe('generalCommands /exit', () => {
    beforeEach(() => {
        clearExitStats();
        mockTriggerExit.mockReset();
    });

    it('shows a ChatGPT usage note instead of zero token totals', async () => {
        const exitCommand = getExitCommand();
        const agent = {
            sessionManager: {
                getSessionMetadata: vi.fn().mockResolvedValue({
                    createdAt: Date.now() - 65_000,
                    tokenUsage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        reasoningTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 0,
                    },
                    usageTracking: {
                        hasUntrackedChatGPTLoginUsage: true,
                    },
                }),
            },
            getSessionHistory: vi.fn().mockResolvedValue([
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ]),
            getCurrentLLMConfig: vi.fn().mockReturnValue({
                provider: 'openai-compatible',
                model: 'gpt-5.4',
                baseURL: 'codex://chatgpt',
            }),
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
            },
        };

        const result = await exitCommand.handler([], agent as never, {
            sessionId: 'session-1',
            configFilePath: null,
        });

        expect(result).toBe(true);
        expect(mockTriggerExit).toHaveBeenCalledTimes(1);
        expect(getExitStats()).toMatchObject({
            sessionId: 'session-1',
            messageCount: {
                total: 2,
                user: 1,
                assistant: 1,
            },
            usageNote:
                'Tracked via ChatGPT Login. Token counts are not available in Dexto for this session.',
        });
        expect(getExitStats()?.tokenUsage).toBeUndefined();
    });

    it('shows partial usage note for mixed ChatGPT and tracked models', async () => {
        const exitCommand = getExitCommand();
        const tokenUsage = {
            inputTokens: 120,
            outputTokens: 45,
            reasoningTokens: 10,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
            totalTokens: 175,
        };
        const agent = {
            sessionManager: {
                getSessionMetadata: vi.fn().mockResolvedValue({
                    createdAt: Date.now() - 30_000,
                    tokenUsage,
                    usageTracking: {
                        hasUntrackedChatGPTLoginUsage: true,
                    },
                }),
            },
            getSessionHistory: vi.fn().mockResolvedValue([
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ]),
            getCurrentLLMConfig: vi.fn().mockReturnValue({
                provider: 'openai',
                model: 'gpt-5',
            }),
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
            },
        };

        await exitCommand.handler([], agent as never, {
            sessionId: 'session-mixed',
            configFilePath: null,
        });

        expect(getExitStats()?.tokenUsage).toEqual(tokenUsage);
        expect(getExitStats()?.usageNote).toBe(
            'Partial totals only. This session used ChatGPT Login and other tracked models; ChatGPT token counts are not available in Dexto.'
        );
    });

    it('preserves token totals for standard providers', async () => {
        const exitCommand = getExitCommand();
        const tokenUsage = {
            inputTokens: 120,
            outputTokens: 45,
            reasoningTokens: 10,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
            totalTokens: 175,
        };
        const agent = {
            sessionManager: {
                getSessionMetadata: vi.fn().mockResolvedValue({
                    createdAt: Date.now() - 30_000,
                    tokenUsage,
                }),
            },
            getSessionHistory: vi.fn().mockResolvedValue([
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ]),
            getCurrentLLMConfig: vi.fn().mockReturnValue({
                provider: 'openai',
                model: 'gpt-5',
            }),
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
            },
        };

        await exitCommand.handler([], agent as never, {
            sessionId: 'session-2',
            configFilePath: null,
        });

        expect(getExitStats()?.tokenUsage).toEqual(tokenUsage);
        expect(getExitStats()?.usageNote).toBeUndefined();
    });
});
