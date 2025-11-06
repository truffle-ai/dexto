import { describe, test, expect } from 'vitest';
import { StarterPromptProvider } from './starter-prompt-provider.js';

const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    trackException: () => {},
    createChild: () => mockLogger,
    destroy: async () => {},
} as any;

describe('StarterPromptProvider.applyArguments', () => {
    test('appends Context at END when no placeholders', async () => {
        const agentConfig: any = {
            starterPrompts: [
                {
                    id: 's1',
                    title: 'T',
                    description: 'D',
                    prompt: 'Starter content',
                    category: 'cat',
                    priority: 1,
                },
            ],
        };
        const provider = new StarterPromptProvider(agentConfig, mockLogger);
        const list = await provider.listPrompts();
        expect(list.prompts.length).toBe(1);

        const res = await provider.getPrompt('starter:s1', { _context: 'CTX' } as any);
        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toBe('Starter content\n\nContext: CTX');
    });

    test('does not append when placeholders present ($1)', async () => {
        const agentConfig: any = {
            starterPrompts: [
                {
                    id: 's2',
                    title: 'T',
                    description: 'D',
                    prompt: 'Use $1 style',
                    category: 'cat',
                    priority: 1,
                },
            ],
        };
        const provider = new StarterPromptProvider(agentConfig, mockLogger);
        const res = await provider.getPrompt('starter:s2', { _context: 'CTX' } as any);
        const text = (res.messages?.[0]?.content as any).text as string;
        // Starter provider does not expand $1, but detects placeholder usage and thus does not append context
        expect(text).toBe('Use $1 style');
    });
});
