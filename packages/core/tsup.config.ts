import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.integration.test.ts'],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        platform: 'node',
        bundle: false,
    },
]);
