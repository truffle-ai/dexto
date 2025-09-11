import { defineConfig } from 'tsup';

export default defineConfig([
    // Node build - Full @dexto/core for server-side use
    {
        entry: {
            index: 'src/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
        platform: 'node',
        noExternal: ['chalk', 'boxen'],
        external: [
            'better-sqlite3',
            'pg',
            'redis',
            'winston',
            'logform',
            '@colors/colors',
            'yaml',
            'fs-extra',
            'dotenv',
            'cross-spawn',
            'tiktoken',
        ],
    },
    // Browser build - Minimal exports for type safety
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
