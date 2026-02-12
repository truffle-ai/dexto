import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: [
            'src/**/*.ts',
            '!src/**/*.test.ts',
            '!src/**/*.integration.test.ts',
            '!src/**/__fixtures__/**/*.ts',
        ],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: false, // Disable DTS generation in tsup to avoid worker memory issues
        platform: 'node',
        bundle: false,
        clean: true,
        tsconfig: './tsconfig.json',
        esbuildOptions(options) {
            // Suppress empty import meta warnings which tsup anyway fixes
            options.logOverride = {
                ...(options.logOverride ?? {}),
                'empty-import-meta': 'silent',
            };
        },
    },
]);
