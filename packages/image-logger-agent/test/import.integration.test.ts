import { describe, it, expect } from 'vitest';
import { loadImage } from '@dexto/agent-config';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

describe('Image Logger Agent - Import Integration', () => {
    it('loads as a valid DextoImageModule', async () => {
        const metaResolve = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
        const imageSpecifier = metaResolve
            ? metaResolve('@dexto/image-logger-agent')
            : pathToFileURL(
                  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')
              ).href;

        const image = await loadImage(imageSpecifier);

        expect(image.metadata.name).toBe('@dexto/image-logger-agent');

        expect(image.hooks['request-logger']).toBeDefined();
        expect(image.hooks['content-policy']).toBeDefined();
        expect(image.hooks['response-sanitizer']).toBeDefined();
    }, 15_000);
});
