import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // @core is used internally within the core package only
            '@core': path.resolve(__dirname, 'packages/core/src'),
            // Workspace aliases for packages used directly in tests
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
