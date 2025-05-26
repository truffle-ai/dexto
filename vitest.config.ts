import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'src/core'),
            '@app': path.resolve(__dirname, 'src/app'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts', '**/*.spec.ts'],
        watch: true,
    },
});
