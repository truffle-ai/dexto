import { describe, expect, test } from 'vitest';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { VercelMessageFormatter } from './vercel.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';

describe('withheld thinking in an Anthropic tool continuation', () => {
    test('the provider adapter receives an ordinary conversation containing the result', async () => {
        const history: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'Find the answer' }] },
            {
                role: 'assistant',
                content: [],
                assistantOutput: { status: 'complete' },
                metadata: { reasoningWithheld: true },
                toolCalls: [
                    {
                        id: 'call-a',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{}' },
                    },
                ],
            },
            {
                role: 'tool',
                name: 'lookup',
                toolCallId: 'call-a',
                success: true,
                content: [{ type: 'text', text: 'answer 42' }],
            },
        ];
        let body = '';
        const provider = createAnthropic({
            apiKey: 'synthetic-test-key',
            fetch: async (_input, init) => {
                if (typeof init?.body === 'string') body = init.body;
                throw new Error('request captured');
            },
        });
        const messages = new VercelMessageFormatter(createMockLogger()).format(
            history,
            { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            null
        );
        await expect(
            generateText({
                model: provider('claude-sonnet-4-6'),
                messages,
                maxRetries: 0,
                maxOutputTokens: 4096,
                providerOptions: {
                    anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } },
                },
            })
        ).rejects.toThrow();
        expect(body).toContain('answer 42');
        expect(body).not.toContain('tool_use');
        expect(body).not.toContain('tool_result');
    });
});
