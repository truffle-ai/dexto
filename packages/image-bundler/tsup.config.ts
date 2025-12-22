import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    shims: true,
    external: ['typescript', '@dexto/core', 'picocolors', 'commander'],
    noExternal: [],
});
