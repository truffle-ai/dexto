import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts', 'src/hono/index.ts', 'src/hono/node/index.ts'],
        format: ['esm', 'cjs'],
        outDir: 'dist',
        dts: true,
        clean: true,
        bundle: false,
        platform: 'node',
        esbuildOptions(options) {
            options.logOverride = {
                ...(options.logOverride ?? {}),
                'empty-import-meta': 'silent',
            };
        },
    },
]);
