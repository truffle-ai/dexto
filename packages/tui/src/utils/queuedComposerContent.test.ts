import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '@dexto/core';
import { previewQueuedContent, restoreQueuedContentForComposer } from './queuedComposerContent.js';

function queuedMessage(content: QueuedMessage['content']): QueuedMessage {
    return {
        id: 'queued-1',
        content,
        queuedAt: 123,
        kind: 'default',
    };
}

describe('queuedComposerContent', () => {
    it('restores queued text-only content without adding attachments', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'first line' },
                { type: 'text', text: 'second line' },
            ])
        );

        expect(result).toEqual({
            ok: true,
            composer: {
                text: 'first line\nsecond line',
                images: [],
            },
        });
    });

    it('restores queued text and image content into composer text plus pending images', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'describe this [Image 1]' },
                { type: 'image', image: 'base64-image', mimeType: 'image/png' },
            ])
        );

        expect(result).toEqual({
            ok: true,
            composer: {
                text: 'describe this [Image 1]',
                images: [
                    {
                        id: 'queued-1-image-1',
                        data: 'base64-image',
                        mimeType: 'image/png',
                        placeholder: '[Image 1]',
                    },
                ],
            },
        });
    });

    it('adds image placeholders when queued text does not already contain them', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'describe this' },
                { type: 'image', image: 'first', mimeType: 'image/png' },
                { type: 'image', image: 'second', mimeType: 'image/jpeg' },
            ])
        );

        expect(result).toMatchObject({
            ok: true,
            composer: {
                text: 'describe this\n[Image 1] [Image 2]',
                images: [
                    { data: 'first', placeholder: '[Image 1]' },
                    { data: 'second', placeholder: '[Image 2]' },
                ],
            },
        });
    });

    it('adds missing image placeholders at the original content position', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'before' },
                { type: 'image', image: 'base64-image', mimeType: 'image/png' },
                { type: 'text', text: 'after' },
            ])
        );

        expect(result).toMatchObject({
            ok: true,
            composer: {
                text: 'before\n[Image 1]\nafter',
                images: [{ data: 'base64-image', placeholder: '[Image 1]' }],
            },
        });
    });

    it('preserves existing image placeholder numbering from queued text', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'describe this [Image 3]' },
                { type: 'image', image: 'base64-image', mimeType: 'image/png' },
            ])
        );

        expect(result).toEqual({
            ok: true,
            composer: {
                text: 'describe this [Image 3]',
                images: [
                    {
                        id: 'queued-1-image-1',
                        data: 'base64-image',
                        mimeType: 'image/png',
                        placeholder: '[Image 3]',
                    },
                ],
            },
        });
    });

    it('refuses terminal edit for unsupported attachment parts instead of dropping them', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'read this file' },
                {
                    type: 'file',
                    data: 'file-data',
                    mimeType: 'text/plain',
                    filename: 'notes.txt',
                },
            ])
        );

        expect(result).toEqual({
            ok: false,
            reason: 'Queued input with non-image attachments cannot be edited in the terminal yet.',
        });
    });

    it('restores binary image payloads instead of dropping them', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'text', text: 'describe this' },
                { type: 'image', image: new Uint8Array([1, 2]), mimeType: 'image/png' },
            ])
        );

        expect(result).toMatchObject({
            ok: true,
            composer: {
                text: 'describe this\n[Image 1]',
                images: [{ data: 'AQI=', placeholder: '[Image 1]' }],
            },
        });
    });

    it('restores ArrayBuffer, Buffer, and URL image payloads', () => {
        const result = restoreQueuedContentForComposer(
            queuedMessage([
                { type: 'image', image: new Uint8Array([3, 4]).buffer, mimeType: 'image/png' },
                { type: 'image', image: Buffer.from([5, 6]), mimeType: 'image/png' },
                { type: 'image', image: new URL('https://example.com/image.png') },
            ])
        );

        expect(result).toMatchObject({
            ok: true,
            composer: {
                text: '[Image 1] [Image 2] [Image 3]',
                images: [
                    { data: 'AwQ=', placeholder: '[Image 1]' },
                    { data: 'BQY=', placeholder: '[Image 2]' },
                    { data: 'https://example.com/image.png', placeholder: '[Image 3]' },
                ],
            },
        });
    });

    it('includes image placeholders and attachment markers in queued previews', () => {
        expect(
            previewQueuedContent([
                { type: 'text', text: 'look at these' },
                { type: 'image', image: 'img', mimeType: 'image/png' },
                { type: 'file', data: 'file', mimeType: 'text/plain', filename: 'notes.txt' },
            ])
        ).toBe('look at these [Image 1] [file: notes.txt]');
    });

    it('does not duplicate image markers already present in queued previews', () => {
        expect(
            previewQueuedContent([
                { type: 'text', text: 'look at this [Image 1]' },
                { type: 'image', image: 'img', mimeType: 'image/png' },
            ])
        ).toBe('look at this [Image 1]');
    });
});
