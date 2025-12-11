import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        outDir: 'dist',
        dts: false, // Use tsc for DTS generation (consistent with other packages)
        clean: true,
        bundle: true,
        platform: 'node',
        // Include JSON files in the bundle
        loader: {
            '.json': 'json',
        },
    },
]);
