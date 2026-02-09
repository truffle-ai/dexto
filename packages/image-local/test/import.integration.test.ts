import { describe, it, expect } from 'vitest';

/**
 * Integration test to ensure image-local can be imported successfully.
 * This catches issues where generated code references renamed/missing exports.
 */
describe('Image Local - Import Integration', () => {
    it('should import image-local without errors', async () => {
        // This will fail if the generated code has incorrect imports
        const module = await import('@dexto/image-local');

        expect(module).toBeDefined();
        expect(module.createAgent).toBeDefined();
        expect(module.imageMetadata).toBeDefined();
    });

    it('should have correct registry exports', async () => {
        const module = await import('@dexto/image-local');

        // Verify all registries are exported with correct names
        expect(module.customToolRegistry).toBeDefined();
        expect(module.pluginRegistry).toBeDefined();
        expect(module.compactionRegistry).toBeDefined();
    });

    it('should not reference old registry names', async () => {
        // Read the generated file to ensure no old names remain
        const fs = await import('fs/promises');
        const path = await import('path');
        const { fileURLToPath } = await import('url');

        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const distPath = path.resolve(currentDir, '../dist/index.js');
        const content = await fs.readFile(distPath, 'utf-8');

        // Should not contain old name
        expect(content).not.toContain('compressionRegistry');
        expect(content).not.toContain('blobStoreRegistry');

        // Should contain new name
        expect(content).toContain('compactionRegistry');
    });
});
