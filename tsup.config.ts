import { defineConfig } from 'tsup';

export default defineConfig([
    // Core entry: bundle CJS, external ESM
    {
        entry: ['src/packages/core/src/index.ts'],
        format: ['cjs', 'esm'],
        outDir: 'dist/src/core',
        dts: true,
        shims: true,
        bundle: true,
        noExternal: ['chalk', 'boxen'],
        external: ['better-sqlite3', 'pg', 'redis'],
    },
    // App entry: only ESM, no bundling needed
    {
        entry: ['src/packages/cli/src/index.ts'],
        format: ['esm'],
        outDir: 'dist/src/cli',
        shims: true,
        loader: { '.json': 'json' },
        external: ['better-sqlite3', 'pg', 'redis'],
    },
]);
