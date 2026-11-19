import { APICallError, type ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { isRejectedModelRequest, withholdRequestMedia } from './withheld-media.js';

const withheldImage = '[Image withheld: the model provider rejected the request that carried it]';
const withheldFile = '[File withheld: the model provider rejected the request that carried it]';

function apiCallError(
    statusCode: number,
    message = 'Provider error',
    responseBody?: string
): APICallError {
    return new APICallError({
        message,
        url: 'https://api.x.ai/v1/chat/completions',
        requestBodyValues: {},
        statusCode,
        isRetryable: false,
        ...(responseBody === undefined ? {} : { responseBody }),
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

        expect(withholdRequestMedia(messages, apiCallError(400))).toEqual([
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

        expect(withholdRequestMedia(messages, apiCallError(400))).toEqual([
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

    // Dexto's Slack re-run on 19 Nov (DEXTO-3266, case C67): a truncated PDF was refused as
    // corrupted, and with only "withheld" to go on the model told the person to re-upload it.
    it('says a file looks damaged when the provider refused it as corrupted', () => {
        const error = apiCallError(
            400,
            'The file you uploaded is badly formatted or corrupted. Please fix the file and try again.',
            '{"error":"The file you uploaded is badly formatted or corrupted. Please fix the file and try again."}'
        );
        const messages: ModelMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'summarise the attached PDF report in 3 bullets' },
                    { type: 'file', data: new Uint8Array([2]), mediaType: 'application/pdf' },
                ],
            },
        ];

        expect(withholdRequestMedia(messages, error)).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'summarise the attached PDF report in 3 bullets' },
                    {
                        type: 'text',
                        text: '[File not read: the model provider could not open it because it is damaged or not a valid file. Tell the person the file looks damaged and could not be read; sending the same file again will not help, so ask for a fresh export or its text.]',
                    },
                ],
            },
        ]);
    });

    it.each([
        'Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting',
        'Could not process image',
        'Invalid file format',
    ])(
        'keeps the neutral note when the provider does not say the file is damaged: %s',
        (message) => {
            const messages: ModelMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'image', image: new Uint8Array([1]), mediaType: 'image/png' },
                    ],
                },
            ];

            expect(withholdRequestMedia(messages, apiCallError(400, message))).toEqual([
                { role: 'user', content: [{ type: 'text', text: withheldImage }] },
            ]);
        }
    );

    it('keeps the neutral note when the request carries more than one media item', () => {
        const error = apiCallError(400, 'The file you uploaded is badly formatted or corrupted.');
        const messages: ModelMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'image', image: new Uint8Array([1]), mediaType: 'image/png' },
                    { type: 'file', data: new Uint8Array([2]), mediaType: 'application/pdf' },
                ],
            },
        ];

        expect(withholdRequestMedia(messages, error)).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: withheldImage },
                    { type: 'text', text: withheldFile },
                ],
            },
        ]);
    });

    it('returns null when no message carries media', () => {
        expect(
            withholdRequestMedia(
                [
                    { role: 'user', content: 'Hello' },
                    { role: 'user', content: [{ type: 'text', text: 'Again' }] },
                ],
                apiCallError(400)
            )
        ).toBeNull();
    });
});
