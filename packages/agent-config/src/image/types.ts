import type {
    BlobStore,
    Cache,
    Database,
    DextoPlugin,
    IDextoLogger,
    // TODO: temporary glue code to be removed/verified
    ICompactionStrategy as CompactionStrategy,
    // TODO: temporary glue code to be removed/verified
    InternalTool as Tool,
} from '@dexto/core';
import type { z } from 'zod';
import type { AgentConfig } from '../schemas/agent-config.js';

// TODO: temporary glue code to be removed/verified
export type ImageTarget =
    | 'local-development'
    | 'cloud-production'
    | 'edge-serverless'
    | 'embedded-iot'
    | 'enterprise'
    | 'custom';

// TODO: temporary glue code to be removed/verified
export type ImageConstraint =
    | 'filesystem-required'
    | 'network-required'
    | 'offline-capable'
    | 'serverless-compatible'
    | 'cold-start-optimized'
    | 'low-memory'
    | 'edge-compatible'
    | 'browser-compatible';

// TODO: temporary glue code to be removed/verified
export type ImageDefaults = Partial<AgentConfig>;

export interface ToolFactoryMetadata {
    displayName: string;
    description: string;
    category: string;
}

export interface ToolFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): Tool[];
    metadata?: ToolFactoryMetadata;
}

export interface BlobStoreFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: IDextoLogger): BlobStore;
}

export interface DatabaseFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: IDextoLogger): Database;
}

export interface CacheFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: IDextoLogger): Cache;
}

export interface PluginFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): DextoPlugin;
}

export interface CompactionFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): CompactionStrategy;
}

export interface LoggerFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): IDextoLogger;
}

export interface DextoImageModule {
    metadata: {
        name: string;
        version: string;
        description: string;
        target?: ImageTarget;
        constraints?: ImageConstraint[];
    };
    defaults?: ImageDefaults;
    tools: Record<string, ToolFactory>;
    storage: {
        blob: Record<string, BlobStoreFactory>;
        database: Record<string, DatabaseFactory>;
        cache: Record<string, CacheFactory>;
    };
    plugins: Record<string, PluginFactory>;
    compaction: Record<string, CompactionFactory>;
    logger: LoggerFactory;
}
