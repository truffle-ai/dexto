import { APICallError, type ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { isRejectedModelRequest, withholdRequestMedia } from './withheld-media.js';

const withheldImage = '[Image withheld: the model provider rejected the request that carried it]';
const withheldFile = '[File withheld: the model provider rejected the request that carried it]';

function apiCallError(statusCode: number): APICallError {
    return new APICallError({
        message: 'Provider error',
        url: 'https://api.x.ai/v1/chat/completions',
        requestBodyValues: {},
        statusCode,
        isRetryable: false,
    });
}

describe('isRejectedModelRequest', () => {
    it('is true only for a provider 400', () => {
        expect(isRejectedModelRequest(apiCallError(400))).toBe(true);
        expect(isRejectedModelRequest(apiCallError(401))).toBe(false);
        expect(isRejectedModelRequest(apiCallError(500))).toBe(false);
        expect(isRejectedModelRequest(new Error('Bad request'))).toBe(false);
    });
});

describe('withholdRequestMedia', () => {
    it('replaces user images and files with placeholders and keeps text', () => {
        const messages: ModelMessage[] = [
            { role: 'system', content: 'You are helpful.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Look' },
                    { type: 'image', image: new Uint8Array([1]), mediaType: 'image/png' },
                    { type: 'file', data: new Uint8Array([2]), mediaType: 'application/pdf' },
                ],
            },
        ];

        expect(withholdRequestMedia(messages)).toEqual([
            { role: 'system', content: 'You are helpful.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Look' },
                    { type: 'text', text: withheldImage },
                    { type: 'text', text: withheldFile },
                ],
            },
        ]);
    });

    it('replaces media in tool results', () => {
        const messages: ModelMessage[] = [
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'read_file',
                        output: {
                            type: 'content',
                            value: [
                                { type: 'text', text: 'photo.png' },
                                { type: 'media', data: 'AAAA', mediaType: 'image/png' },
                            ],
                        },
                    },
                ],
            },
        ];

        expect(withholdRequestMedia(messages)).toEqual([
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'read_file',
                        output: {
                            type: 'content',
                            value: [
                                { type: 'text', text: 'photo.png' },
                                { type: 'text', text: withheldImage },
                            ],
                        },
                    },
                ],
            },
        ]);
    });

    it('returns null when no message carries media', () => {
        expect(
            withholdRequestMedia([
                { role: 'user', content: 'Hello' },
                { role: 'user', content: [{ type: 'text', text: 'Again' }] },
            ])
        ).toBeNull();
    });
});
