import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: [
            // Workspace aliases for packages used directly in tests
            {
                find: /^@dexto\/core\/(approval|config|errors|events|llm|logger|mcp|memory|search|storage|tools|workspace)$/,
                replacement: path.resolve(__dirname, 'packages/core/src/$1/index.ts'),
            },
            {
                find: '@dexto/core/utils/path.js',
                replacement: path.resolve(__dirname, 'packages/core/src/utils/path.ts'),
            },
            {
                find: '@dexto/agent-config',
                replacement: path.resolve(__dirname, 'packages/agent-config/src/index.ts'),
            },
            {
                find: '@dexto/core',
                replacement: path.resolve(__dirname, 'packages/core/src/index.ts'),
            },
            {
                find: '@dexto/agent-management',
                replacement: path.resolve(__dirname, 'packages/agent-management/src/index.ts'),
            },
            {
                find: '@dexto/storage/schemas',
                replacement: path.resolve(__dirname, 'packages/storage/src/schemas.ts'),
            },
            {
                find: '@dexto/storage',
                replacement: path.resolve(__dirname, 'packages/storage/src/index.ts'),
            },
        ],
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts', '**/*.spec.ts', '**/*.integration.test.ts'],
        watch: true,
        setupFiles: ['./vitest.setup.ts'],
    },
});
