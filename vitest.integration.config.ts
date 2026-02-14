import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {},
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
