import { describe, it, expect } from 'vitest';
import { loadImage } from '@dexto/agent-config';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Integration test to ensure image-local can be imported successfully and
 * satisfies the DextoImageModule contract.
 */
describe('Image Local - Import Integration', () => {
    it('loads as a valid DextoImageModule', async () => {
        const metaResolve = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
        const imageSpecifier = metaResolve
            ? metaResolve('@dexto/image-local')
            : pathToFileURL(
                  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')
              ).href;

        const image = await loadImage(imageSpecifier);

        expect(image.metadata.name).toBe('@dexto/image-local');

        const prompts = image.defaults?.prompts ?? [];
        const planPrompt = prompts.find(
            (p) => p.type === 'inline' && 'id' in p && p.id === 'dexto-plan-mode'
        );
        expect(planPrompt).toBeDefined();
        expect(planPrompt).toMatchObject({
            type: 'inline',
            id: 'dexto-plan-mode',
            'user-invocable': false,
            'disable-model-invocation': true,
        });

        expect(image.tools['builtin-tools']).toBeDefined();
        expect(image.tools['filesystem-tools']).toBeDefined();
        expect(image.tools['process-tools']).toBeDefined();
        expect(image.tools['todo-tools']).toBeDefined();
        expect(image.tools['plan-tools']).toBeDefined();
        expect(image.tools['agent-spawner']).toBeDefined();

        expect(image.storage.blob['local']).toBeDefined();
        expect(image.storage.database['sqlite']).toBeDefined();
        expect(image.storage.cache['in-memory']).toBeDefined();

        expect(image.hooks['content-policy']).toBeDefined();
        expect(image.hooks['response-sanitizer']).toBeDefined();

        expect(image.logger).toBeDefined();
    }, 15_000);
});
