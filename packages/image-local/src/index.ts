import {
    type DextoImage,
    type HookFactory,
    type CompactionFactory,
    NoOpCompactionConfigSchema,
    type NoOpCompactionConfig,
    ReactiveOverflowCompactionConfigSchema,
    type ReactiveOverflowCompactionConfig,
} from '@dexto/agent-config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { schedulerToolsFactory } from '@dexto/tools-scheduler';
import { lifecycleToolsFactory } from '@dexto/tools-lifecycle';
import { agentSpawnerToolsFactory, creatorToolsFactory } from '@dexto/agent-management';

function readPackageJson(packageJsonPath: string): { name?: string; version?: string } | null {
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
            name?: string;
            version?: string;
        };
    } catch {
        return null;
    }
}

function resolveModuleDir(): string | undefined {
    const importMetaUrl = typeof import.meta !== 'undefined' ? import.meta.url : undefined;
    if (importMetaUrl) {
        return path.dirname(fileURLToPath(importMetaUrl));
    }

    const filenameFromGlobal = (globalThis as { __filename?: unknown }).__filename;
    if (typeof filenameFromGlobal === 'string' && filenameFromGlobal.length > 0) {
        return path.dirname(filenameFromGlobal);
    }

    return undefined;
}

function resolveImageMetadata(defaultName: string): { name: string; version: string } {
    const moduleDir = resolveModuleDir();
    if (moduleDir) {
        const localPackageJson = readPackageJson(path.resolve(moduleDir, '..', 'package.json'));
        if (localPackageJson) {
            return {
                name: localPackageJson.name ?? defaultName,
                version: localPackageJson.version ?? '0.0.0',
            };
        }
    }

    const packageRoot = process.env.DEXTO_PACKAGE_ROOT;
    if (packageRoot) {
        const bundledPackageJson = readPackageJson(path.join(packageRoot, 'package.json'));
        if (bundledPackageJson) {
            return {
                name: defaultName,
                version: bundledPackageJson.version ?? '0.0.0',
            };
        }
    }

    return {
        name: defaultName,
        version: process.env.DEXTO_CLI_VERSION || '0.0.0',
    };
}

const imageMetadata = resolveImageMetadata('@dexto/image-local');

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

const imageLocal: DextoImage = {
    metadata: {
        name: imageMetadata.name,
        version: imageMetadata.version,
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
            { type: 'scheduler-tools' },
            { type: 'lifecycle-tools' },
            { type: 'creator-tools' },
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
                    '- Create a plan: `plan_create`',
                    '- Update a plan: `plan_update`',
                    '- Read the current plan: `plan_read`',
                    '- Request user approval: `plan_review`',
                    '',
                    'After drafting the plan, call `plan_create` (or `plan_update` if it already exists), then call `plan_review`.',
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
        'scheduler-tools': schedulerToolsFactory,
        'lifecycle-tools': lifecycleToolsFactory,
        'creator-tools': creatorToolsFactory,
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
