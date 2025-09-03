import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // @core is used internally within the core package only
            '@core': path.resolve(__dirname, 'packages/core/src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.integration.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        watch: false,
        setupFiles: ['./vitest.setup.ts'],
    },
});
