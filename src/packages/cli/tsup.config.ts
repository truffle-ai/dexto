import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    shims: true,
    platform: 'node',
    external: [
        '@dexto/core',
        'better-sqlite3',
        'pg',
        'redis',
        'commander',
        '@clack/prompts',
        'chalk',
        'boxen',
        'express',
        'ws',
        'yaml',
        'dotenv',
    ],
});
