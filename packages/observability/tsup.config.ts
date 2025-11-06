import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: [
            'src/**/*.ts',
            'src/**/*.tsx',
            '!src/**/*.test.ts',
            '!src/**/*.test.tsx',
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
    // Separate config for static files (CSS, HTML)
    {
        entry: ['src/**/*.css', 'src/**/*.html'],
        format: ['esm'],
        outDir: 'dist',
        clean: false,
        bundle: false,
        platform: 'node',
        loader: {
            '.css': 'copy',
            '.html': 'copy',
        },
    },
]);
