import {
    BuiltInPluginConfigSchema,
    type DextoImageModule,
    type PluginFactory,
    type CompactionFactory,
} from '@dexto/agent-config';
import {
    ContentPolicyPlugin,
    ResponseSanitizerPlugin,
    defaultLoggerFactory,
    NoOpCompactionStrategy,
    NoOpConfigSchema,
} from '@dexto/core';
import {
    localBlobStoreFactory,
    inMemoryBlobStoreFactory,
    sqliteFactory,
    postgresFactory,
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

const contentPolicyFactory: PluginFactory = {
    configSchema: BuiltInPluginConfigSchema,
    create: (_config) => new ContentPolicyPlugin(),
};

const responseSanitizerFactory: PluginFactory = {
    configSchema: BuiltInPluginConfigSchema,
    create: (_config) => new ResponseSanitizerPlugin(),
};

const noopCompactionFactory: CompactionFactory = {
    configSchema: NoOpConfigSchema,
    create: (_config) => new NoOpCompactionStrategy(),
};

const imageLocal: DextoImageModule = {
    metadata: {
        name: 'image-local',
        version: '1.0.0',
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
            sqlite: sqliteFactory,
            postgres: postgresFactory,
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
        noop: noopCompactionFactory,
    },
    logger: defaultLoggerFactory,
};

export default imageLocal;
