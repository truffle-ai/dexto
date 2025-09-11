import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        // Generate declaration files without resolving workspace deps
        dts: { resolve: false },
        shims: true,
        bundle: true,
        platform: 'neutral',
        external: ['@dexto/core'],
    },
]);
