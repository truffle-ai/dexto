import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    outDir: '../../dist/src/core',
    dts: true,
    shims: true,
    bundle: true,
    noExternal: ['chalk', 'boxen'],
    external: ['better-sqlite3', 'pg', 'redis'],
});
