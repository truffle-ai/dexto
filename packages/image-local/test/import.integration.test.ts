import { describe, it, expect } from 'vitest';
import { loadImage } from '@dexto/agent-config';

/**
 * Integration test to ensure image-local can be imported successfully and
 * satisfies the DextoImageModule contract.
 */
describe('Image Local - Import Integration', () => {
    it('loads as a valid DextoImageModule', async () => {
        const image = await loadImage('@dexto/image-local');

        expect(image.metadata.name).toBe('image-local');

        expect(image.tools['builtin-tools']).toBeDefined();
        expect(image.tools['filesystem-tools']).toBeDefined();
        expect(image.tools['process-tools']).toBeDefined();
        expect(image.tools['todo-tools']).toBeDefined();
        expect(image.tools['plan-tools']).toBeDefined();
        expect(image.tools['agent-spawner']).toBeDefined();

        expect(image.storage.blob['local']).toBeDefined();
        expect(image.storage.database['sqlite']).toBeDefined();
        expect(image.storage.cache['in-memory']).toBeDefined();

        expect(image.plugins['content-policy']).toBeDefined();
        expect(image.plugins['response-sanitizer']).toBeDefined();

        expect(image.logger).toBeDefined();
    });
});
