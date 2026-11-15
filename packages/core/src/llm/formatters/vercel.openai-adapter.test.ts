import { describe, expect, test, vi } from 'vitest';
import { generateText, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { VercelMessageFormatter } from './vercel.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REQUEST_REACHED_NETWORK = 'request reached the network stub';

function createOpenAIWithRecordingFetch() {
    const fetchStub = vi.fn(async () => {
        throw new Error(REQUEST_REACHED_NETWORK);
    });
    const openai = createOpenAI({ apiKey: 'test-key', fetch: fetchStub as typeof fetch });
    return { model: openai.responses('gpt-5.4-mini'), fetchStub };
}

function userMessageWith(file: {
    mimeType: string;
    filename: string;
    data: string;
}): InternalMessage[] {
    return [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'Summarize the attachment' },
                { type: 'file', ...file },
            ],
        },
    ];
}

describe('VercelMessageFormatter output against the real @ai-sdk/openai adapter', () => {
    const formatter = new VercelMessageFormatter(createMockLogger());
    const context = { provider: 'openai', model: 'gpt-5.4-mini' } as const;
    const docx = {
        mimeType: DOCX,
        filename: 'report.docx',
        data: Buffer.from('not really a docx').toString('base64'),
    };

    test('control: an unfiltered Office file part makes the adapter throw before any request', async () => {
        const { model, fetchStub } = createOpenAIWithRecordingFetch();
        const messages: ModelMessage[] = [
            {
                role: 'user',
                content: [{ type: 'file', data: docx.data, mediaType: DOCX }],
            },
        ];

        await expect(generateText({ model, messages, maxRetries: 0 })).rejects.toThrow(
            /file part media type/
        );
        expect(fetchStub).not.toHaveBeenCalled();
    });

    test('an Office attachment no longer fails the run: the request is built and sent', async () => {
        const { model, fetchStub } = createOpenAIWithRecordingFetch();
        const messages = formatter.format(userMessageWith(docx), context, null);

        await expect(generateText({ model, messages, maxRetries: 0 })).rejects.toThrow(
            REQUEST_REACHED_NETWORK
        );
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    test('a PDF attachment is still sent as a file input', async () => {
        const { model, fetchStub } = createOpenAIWithRecordingFetch();
        const messages = formatter.format(
            userMessageWith({ ...docx, mimeType: 'application/pdf', filename: 'report.pdf' }),
            context,
            null
        );

        await expect(generateText({ model, messages, maxRetries: 0 })).rejects.toThrow(
            REQUEST_REACHED_NETWORK
        );
        expect(fetchStub).toHaveBeenCalledTimes(1);
        const [, init] = fetchStub.mock.calls[0] as unknown as [unknown, { body: string }];
        expect(init.body).toContain('input_file');
    });
});
