import { describe, expect, it, vi } from 'vitest';
import type { ContentPart, ResourcePart, UIResourcePart } from './types.js';
import { cloneContentPart, cloneContentParts } from './content-clone.js';

describe('content clone utilities', () => {
    it('preserves URL payloads without sharing mutable URL objects', () => {
        const sourceUrl = new URL('https://example.com/image.png');
        const cloned = cloneContentPart({
            type: 'image',
            image: sourceUrl,
            mimeType: 'image/png',
        });

        sourceUrl.pathname = '/mutated.png';

        expect(cloned).toEqual({
            type: 'image',
            image: new URL('https://example.com/image.png'),
            mimeType: 'image/png',
        });
        if (cloned.type !== 'image') throw new Error('Expected image part');
        expect(cloned.image).toBeInstanceOf(URL);
    });

    it('clones Uint8Array payloads without requiring a global Buffer', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        vi.stubGlobal('Buffer', undefined);

        try {
            const cloned = cloneContentPart({
                type: 'image',
                image: bytes,
                mimeType: 'image/png',
            });

            bytes[0] = 9;

            expect(cloned).toEqual({
                type: 'image',
                image: new Uint8Array([1, 2, 3]),
                mimeType: 'image/png',
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('drops unknown fields while cloning resource metadata', () => {
        const resourceWithExtra: ResourcePart & { extra: { nested: boolean } } = {
            type: 'resource',
            uri: 'file:///tmp/chart.png',
            name: 'chart.png',
            mimeType: 'image/png',
            kind: 'image',
            metadata: { source: 'filesystem' },
            extra: { nested: true },
        };
        const uiResourceWithExtra: UIResourcePart & { extra: { nested: boolean } } = {
            type: 'ui-resource',
            uri: 'ui://dashboard',
            mimeType: 'text/html',
            content: '<section>Dashboard</section>',
            metadata: { preferredSize: { width: 640, height: 480 } },
            extra: { nested: true },
        };
        const source: ContentPart[] = [resourceWithExtra, uiResourceWithExtra];

        const cloned = cloneContentParts(source);
        const first = cloned[0];
        const second = cloned[1];
        if (first?.type !== 'resource') throw new Error('Expected resource part');
        if (second?.type !== 'ui-resource') throw new Error('Expected UI resource part');
        first.metadata = { source: 'upload' };
        if (second.metadata?.preferredSize) second.metadata.preferredSize.width = 1;

        expect(cloned).toEqual([
            {
                type: 'resource',
                uri: 'file:///tmp/chart.png',
                name: 'chart.png',
                mimeType: 'image/png',
                kind: 'image',
                metadata: { source: 'upload' },
            },
            {
                type: 'ui-resource',
                uri: 'ui://dashboard',
                mimeType: 'text/html',
                content: '<section>Dashboard</section>',
                metadata: { preferredSize: { width: 1, height: 480 } },
            },
        ]);
        expect(source[0]).toEqual(
            expect.objectContaining({
                metadata: { source: 'filesystem' },
                extra: { nested: true },
            })
        );
        expect(source[1]).toEqual(
            expect.objectContaining({
                metadata: { preferredSize: { width: 640, height: 480 } },
                extra: { nested: true },
            })
        );
    });
});
