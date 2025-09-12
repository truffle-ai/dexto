import { defineConfig } from 'tsup';

export default defineConfig([
    // Node build - Full @dexto/core for server-side use
    {
        entry: {
            index: 'src/index.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
        platform: 'node',
        noExternal: ['chalk', 'boxen'],
        external: [
            'better-sqlite3',
            'pg',
            'redis',
            'winston',
            'logform',
            '@colors/colors',
            'yaml',
            'fs-extra',
            'dotenv',
            'cross-spawn',
            'tiktoken',
            // OpenTelemetry packages - externalize to avoid dynamic require issues
            '@opentelemetry/sdk-node',
            '@opentelemetry/sdk-trace-node',
            '@opentelemetry/auto-instrumentations-node',
            '@opentelemetry/semantic-conventions',
            '@opentelemetry/resources',
            '@opentelemetry/exporter-trace-otlp-http',
            '@opentelemetry/exporter-trace-otlp-grpc',
            '@opentelemetry/sdk-trace-base',
            '@opentelemetry/api',
            '@opentelemetry/context-async-hooks',
        ],
    },
    // Browser build - Minimal exports for type safety
    {
        entry: {
            'index.browser': 'src/index.browser.ts',
        },
        format: ['cjs', 'esm'],
        outDir: 'dist',
        dts: true,
        shims: true,
        bundle: true,
    },
]);
