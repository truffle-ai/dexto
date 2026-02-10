import { describe, expect, it } from 'vitest';
import { loadImage } from './load-image.js';

describe('loadImage', () => {
    it('loads a valid DextoImageModule export', async () => {
        const image = await loadImage('./__fixtures__/valid-image.ts');
        expect(image.metadata.name).toBe('fixture-image');
    });

    it('throws a clear error when import fails', async () => {
        await expect(loadImage('this-image-does-not-exist-123')).rejects.toThrow(
            "Failed to import image 'this-image-does-not-exist-123'"
        );
    });

    it('throws a clear error when the module export is not a DextoImageModule', async () => {
        await expect(loadImage('@dexto/core')).rejects.toThrow("Invalid image '@dexto/core':");
    });
});
