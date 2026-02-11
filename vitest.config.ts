import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Workspace aliases for packages used directly in tests
            '@dexto/agent-config': path.resolve(__dirname, 'packages/agent-config/src/index.ts'),
            '@dexto/agent-management': path.resolve(
                __dirname,
                'packages/agent-management/src/index.ts'
            ),
            '@dexto/storage/schemas': path.resolve(__dirname, 'packages/storage/src/schemas.ts'),
            '@dexto/storage': path.resolve(__dirname, 'packages/storage/src/index.ts'),
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
