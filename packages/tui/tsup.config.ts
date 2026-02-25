import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/**/*.ts', 'src/**/*.tsx'],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: {
            entry: 'src/index.ts',
            compilerOptions: {
                skipLibCheck: true,
                composite: false,
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
