import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'logger/index': 'src/logger/index.ts',
        'storage/index': 'src/storage/index.ts',
    },
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: true,
    shims: true,
    bundle: false,
    noExternal: ['chalk', 'boxen'],
    external: ['better-sqlite3', 'pg', 'redis'],
});
