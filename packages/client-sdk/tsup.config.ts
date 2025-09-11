import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
        platform: 'neutral',
        external: ['@dexto/core'],
    },
]);
