import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        outDir: 'dist',
        dts: false,
        clean: true,
        bundle: true,
        platform: 'node',
    },
]);
