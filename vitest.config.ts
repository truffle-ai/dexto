import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'src/packages/core/src'),
            '@app': path.resolve(__dirname, 'src/app'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts', '**/*.spec.ts', '**/*.integration.test.ts'],
        watch: true,
        setupFiles: ['./vitest.setup.ts'],
    },
});
