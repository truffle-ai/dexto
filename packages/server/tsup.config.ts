import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: [
            'src/**/*.ts',
            '!src/**/*.test.ts',
            '!src/**/*.spec.ts',
            '!src/**/*.integration.test.ts',
        ],
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
