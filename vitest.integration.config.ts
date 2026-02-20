import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@dexto/core/utils/path.js': path.resolve(__dirname, 'packages/core/src/utils/path.ts'),
            '@dexto/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
            '@dexto/agent-config': path.resolve(__dirname, 'packages/agent-config/src/index.ts'),
            '@dexto/agent-management': path.resolve(
                __dirname,
                'packages/agent-management/src/index.ts'
            ),
            '@dexto/tools-builtins': path.resolve(
                __dirname,
                'packages/tools-builtins/src/index.ts'
            ),
            '@dexto/tools-filesystem': path.resolve(
                __dirname,
                'packages/tools-filesystem/src/index.ts'
            ),
            '@dexto/tools-lifecycle': path.resolve(
                __dirname,
                'packages/tools-lifecycle/src/index.ts'
            ),
            '@dexto/tools-plan': path.resolve(__dirname, 'packages/tools-plan/src/index.ts'),
            '@dexto/tools-process': path.resolve(__dirname, 'packages/tools-process/src/index.ts'),
            '@dexto/tools-todo': path.resolve(__dirname, 'packages/tools-todo/src/index.ts'),
            '@dexto/image-local': path.resolve(__dirname, 'packages/image-local/src/index.ts'),
            '@dexto/image-logger-agent': path.resolve(
                __dirname,
                'packages/image-logger-agent/src/index.ts'
            ),
            '@dexto/orchestration': path.resolve(__dirname, 'packages/orchestration/src/index.ts'),
            '@dexto/analytics': path.resolve(__dirname, 'packages/analytics/src/index.ts'),
            '@dexto/storage/schemas': path.resolve(__dirname, 'packages/storage/src/schemas.ts'),
            '@dexto/storage': path.resolve(__dirname, 'packages/storage/src/index.ts'),
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
