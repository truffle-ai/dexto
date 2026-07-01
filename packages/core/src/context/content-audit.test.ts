import { describe, expect, it } from 'vitest';
import {
    describeContentInputForAudit,
    describeContentPartsForAudit,
    describeInternalMessageTailForAudit,
} from './content-audit.js';
import type { InternalMessage } from './types.js';

describe('content audit summaries', () => {
    it('summarizes content input without exposing raw text', async () => {
        await expect(describeContentInputForAudit('hello')).resolves.toEqual({
            totalParts: 1,
            textParts: 1,
            imageParts: 0,
            fileParts: 0,
            resourceParts: 0,
            uiResourceParts: 0,
            textLength: 5,
            textSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        });
    });

    it('counts multimodal content and hashes joined text parts', async () => {
        await expect(
            describeContentPartsForAudit([
                { type: 'text', text: 'hello' },
                { type: 'image', image: 'image-data', mimeType: 'image/png' },
                { type: 'file', data: 'file-data', mimeType: 'text/plain' },
                {
                    type: 'resource',
                    uri: 'resource://one',
                    name: 'one',
                    mimeType: 'text/plain',
                    kind: 'text',
                },
                { type: 'ui-resource', uri: 'ui://one', mimeType: 'text/html' },
                { type: 'text', text: 'world' },
            ])
        ).resolves.toEqual({
            totalParts: 6,
            textParts: 2,
            imageParts: 1,
            fileParts: 1,
            resourceParts: 1,
            uiResourceParts: 1,
            textLength: 10,
            textSha256: '26c60a61d01db5836ca70fefd44a6a016620413c8ef5f259a6c5612d4f79d3b8',
        });
    });

    it('summarizes the message tail with roles and content presence', async () => {
        const messages: InternalMessage[] = [
            { role: 'user', id: 'user-1', timestamp: 1, content: [{ type: 'text', text: 'one' }] },
            {
                role: 'assistant',
                assistantOutput: { status: 'complete' },
                id: 'assistant-1',
                timestamp: 2,
                content: null,
                toolCalls: [
                    {
                        id: 'tool-call-1',
                        type: 'function',
                        function: { name: 'test', arguments: '{}' },
                    },
                ],
            },
        ];

        await expect(describeInternalMessageTailForAudit(messages, 1)).resolves.toEqual([
            {
                role: 'assistant',
                messageId: 'assistant-1',
                timestamp: 2,
                contentPresent: false,
                totalParts: 0,
                textParts: 0,
                imageParts: 0,
                fileParts: 0,
                resourceParts: 0,
                uiResourceParts: 0,
                textLength: 0,
            },
        ]);
    });
});
