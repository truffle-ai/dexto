import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/**/*.ts', 'src/**/*.tsx'],
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: false, // Use tsc for declaration files; tsup DTS is redundant and brittle in workspace builds
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
