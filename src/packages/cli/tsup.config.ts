import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: '../../dist/src/cli',
    shims: true,
    external: ['better-sqlite3', 'pg', 'redis'],
});
