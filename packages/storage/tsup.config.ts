import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: [
            'src/**/*.ts',
            '!src/**/*.d.ts',
            '!src/**/*.test.ts',
            '!src/**/*.integration.test.ts',
        ],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: {
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
