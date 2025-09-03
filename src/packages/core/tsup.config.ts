import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'logger/index': 'src/logger/index.ts',
        'logger/browser': 'src/logger/browser.ts',
        'storage/index': 'src/storage/index.ts',
        // Keep additional entries minimal; root export will re-export needed APIs for CLI
    },
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: true,
    shims: true,
    bundle: false,
    noExternal: ['chalk', 'boxen'],
    external: ['better-sqlite3', 'pg', 'redis'],
});
