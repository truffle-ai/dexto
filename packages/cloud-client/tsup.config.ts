import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: false, // Disable DTS generation in tsup to avoid worker memory issues
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
