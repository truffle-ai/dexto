import {
    type DextoImageModule,
    type HookFactory,
    type CompactionFactory,
    NoOpCompactionConfigSchema,
    type NoOpCompactionConfig,
    ReactiveOverflowCompactionConfigSchema,
    type ReactiveOverflowCompactionConfig,
} from '@dexto/agent-config';
import { createRequire } from 'module';
import { z } from 'zod';
import {
    ContentPolicyHook,
    ResponseSanitizerHook,
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

const contentPolicyFactory: HookFactory<z.output<typeof contentPolicyConfigSchema>> = {
    configSchema: contentPolicyConfigSchema,
    create: (_config) => new ContentPolicyHook(),
};

const responseSanitizerFactory: HookFactory<z.output<typeof responseSanitizerConfigSchema>> = {
    configSchema: responseSanitizerConfigSchema,
    create: (_config) => new ResponseSanitizerHook(),
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
        prompts: [
            {
                type: 'inline',
                id: 'dexto-plan-mode',
                title: 'Plan Mode',
                description:
                    'Internal prompt used by the CLI plan mode toggle. This is injected into the first user message when plan mode is enabled.',
                'user-invocable': false,
                'disable-model-invocation': true,
                prompt: [
                    'You are in PLAN MODE.',
                    '',
                    'Goal: produce a concrete implementation plan before making changes.',
                    '',
                    'Rules:',
                    '- Ask clarifying questions only if required to create a correct plan.',
                    '- Write a short, ordered checklist in markdown using `- [ ]` items.',
                    '- Do not start implementing until the user approves the plan.',
                    '',
                    'Plan tools:',
                    '- Create a plan: `custom--plan_create`',
                    '- Update a plan: `custom--plan_update`',
                    '- Read the current plan: `custom--plan_read`',
                    '- Request user approval: `custom--plan_review`',
                    '',
                    'After drafting the plan, call `custom--plan_create` (or `custom--plan_update` if it already exists), then call `custom--plan_review`.',
                ].join('\n'),
            },
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
    hooks: {
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
