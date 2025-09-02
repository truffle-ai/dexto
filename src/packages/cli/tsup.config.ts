import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: '../../dist/src/app',
    shims: true,
    external: ['better-sqlite3', 'pg', 'redis'],
});
