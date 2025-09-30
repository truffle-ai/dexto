import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: { resolve: true },
    shims: true,
    bundle: true,
    platform: 'neutral',
    target: 'es2018',
    minify: false,
    splitting: false,
    treeshake: false,
    clean: true,
    sourcemap: false,
});
