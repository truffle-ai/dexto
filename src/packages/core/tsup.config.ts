import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        web: 'src/web.ts',
    },
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: true,
    shims: true,
    bundle: true,
    noExternal: ['chalk', 'boxen'],
    external: ['better-sqlite3', 'pg', 'redis'],
});
