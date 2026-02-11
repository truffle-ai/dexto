import {
    type DextoImageModule,
    type PluginFactory,
    type CompactionFactory,
    NoOpCompactionConfigSchema,
    type NoOpCompactionConfig,
    ReactiveOverflowCompactionConfigSchema,
    type ReactiveOverflowCompactionConfig,
} from '@dexto/agent-config';
import { createRequire } from 'module';
import { z } from 'zod';
import {
    ContentPolicyPlugin,
    ResponseSanitizerPlugin,
    defaultLoggerFactory,
    NoOpCompactionStrategy,
    ReactiveOverflowCompactionStrategy,
} from '@dexto/core';
import {
    localBlobStoreFactory,
    inMemoryBlobStoreFactory,
    sqliteDatabaseFactory,
    postgresDatabaseFactory,
    inMemoryDatabaseFactory,
    inMemoryCacheFactory,
    redisCacheFactory,
} from '@dexto/storage';
import { builtinToolsFactory } from '@dexto/tools-builtins';
import { fileSystemToolsFactory } from '@dexto/tools-filesystem';
import { processToolsFactory } from '@dexto/tools-process';
import { todoToolsFactory } from '@dexto/tools-todo';
import { planToolsFactory } from '@dexto/tools-plan';
import { agentSpawnerToolsFactory } from '@dexto/agent-management';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name?: string; version?: string };

const contentPolicyConfigSchema = z
    .object({
        type: z.literal('content-policy'),
        maxInputChars: z.number().int().positive().optional(),
        redactEmails: z.boolean().optional(),
        redactApiKeys: z.boolean().optional(),
    })
    .strict();

const responseSanitizerConfigSchema = z
    .object({
        type: z.literal('response-sanitizer'),
        redactEmails: z.boolean().optional(),
        redactApiKeys: z.boolean().optional(),
        maxResponseLength: z.number().int().positive().optional(),
    })
    .strict();

const contentPolicyFactory: PluginFactory<z.output<typeof contentPolicyConfigSchema>> = {
    configSchema: contentPolicyConfigSchema,
    create: (_config) => new ContentPolicyPlugin(),
};

const responseSanitizerFactory: PluginFactory<z.output<typeof responseSanitizerConfigSchema>> = {
    configSchema: responseSanitizerConfigSchema,
    create: (_config) => new ResponseSanitizerPlugin(),
};

const noopCompactionFactory: CompactionFactory<NoOpCompactionConfig> = {
    configSchema: NoOpCompactionConfigSchema,
    create: (config) =>
        new NoOpCompactionStrategy({
            enabled: config.enabled,
            maxContextTokens: config.maxContextTokens,
            thresholdPercent: config.thresholdPercent,
        }),
};

const reactiveOverflowCompactionFactory: CompactionFactory<ReactiveOverflowCompactionConfig> = {
    configSchema: ReactiveOverflowCompactionConfigSchema,
    create: (config) =>
        new ReactiveOverflowCompactionStrategy({
            enabled: config.enabled,
            maxContextTokens: config.maxContextTokens,
            thresholdPercent: config.thresholdPercent,
            strategy: {
                preserveLastNTurns: config.preserveLastNTurns,
                maxSummaryTokens: config.maxSummaryTokens,
                ...(config.summaryPrompt !== undefined && { summaryPrompt: config.summaryPrompt }),
            },
        }),
};

const imageLocal: DextoImageModule = {
    metadata: {
        name: packageJson.name ?? '@dexto/image-local',
        version: packageJson.version ?? '0.0.0',
        description: 'Local development image with filesystem and process tools',
        target: 'local-development',
        constraints: ['filesystem-required', 'offline-capable'],
    },
    defaults: {
        storage: {
            blob: { type: 'local', storePath: './data/blobs' },
            database: { type: 'sqlite', path: './data/agent.db' },
            cache: { type: 'in-memory' },
        },
        tools: [
            { type: 'builtin-tools' },
            { type: 'filesystem-tools' },
            { type: 'process-tools' },
            { type: 'todo-tools' },
            { type: 'plan-tools' },
            { type: 'agent-spawner' },
        ],
    },
    tools: {
        'builtin-tools': builtinToolsFactory,
        'filesystem-tools': fileSystemToolsFactory,
        'process-tools': processToolsFactory,
        'todo-tools': todoToolsFactory,
        'plan-tools': planToolsFactory,
        'agent-spawner': agentSpawnerToolsFactory,
    },
    storage: {
        blob: {
            local: localBlobStoreFactory,
            'in-memory': inMemoryBlobStoreFactory,
        },
        database: {
            sqlite: sqliteDatabaseFactory,
            postgres: postgresDatabaseFactory,
            'in-memory': inMemoryDatabaseFactory,
        },
        cache: {
            'in-memory': inMemoryCacheFactory,
            redis: redisCacheFactory,
        },
    },
    plugins: {
        'content-policy': contentPolicyFactory,
        'response-sanitizer': responseSanitizerFactory,
    },
    compaction: {
        'reactive-overflow': reactiveOverflowCompactionFactory,
        noop: noopCompactionFactory,
    },
    logger: defaultLoggerFactory,
};

export default imageLocal;
