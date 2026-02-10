import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/**/*.ts'],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: {
            compilerOptions: {
                skipLibCheck: true,
            },
        },
        platform: 'node',
        bundle: false,
        clean: true,
        tsconfig: './tsconfig.json',
        esbuildOptions(options) {
            options.logOverride = {
                ...(options.logOverride ?? {}),
                'empty-import-meta': 'silent',
            };
        },
    },
]);
