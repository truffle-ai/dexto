import { defineConfig } from 'tsup';

export default defineConfig([
    // CLI entry: only ESM, no bundling needed
    {
        entry: ['src/packages/cli/src/index.ts'],
        format: ['esm'],
        outDir: 'dist/src/cli',
        shims: true,
        loader: { '.json': 'json' },
        external: ['better-sqlite3', 'pg', 'redis'],
    },
]);
