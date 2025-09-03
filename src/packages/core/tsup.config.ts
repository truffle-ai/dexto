import { defineConfig } from 'tsup';

export default defineConfig([
    // Node build (CLI/Server consumers) — bundle only the root index to avoid deep relative imports.
    {
        entry: {
            index: 'src/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
        noExternal: ['chalk', 'boxen'],
        external: ['better-sqlite3', 'pg', 'redis'],
    },
    // Node sub-entries (logger, storage) — keep unbundled for clarity.
    {
        entry: {
            'logger/index': 'src/logger/index.ts',
            'logger/browser': 'src/logger/browser.ts',
            'storage/index': 'src/storage/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: false,
        noExternal: ['chalk', 'boxen'],
        external: ['better-sqlite3', 'pg', 'redis'],
    },
    // Browser-safe root entry — bundle to self-contain.
    {
        entry: {
            'index.browser': 'src/index.browser.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
    },
]);
