import type {
    BlobStore,
    Cache,
    Database,
    DextoPlugin,
    IDextoLogger,
    ICompactionStrategy as CompactionStrategy,
    InternalTool as Tool,
} from '@dexto/core';
import type { z } from 'zod';
import type { AgentConfig } from '../schemas/agent-config.js';

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
    create(config: TConfig, logger: IDextoLogger): BlobStore | Promise<BlobStore>;
    metadata?: Record<string, unknown> | undefined;
}

export interface DatabaseFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: IDextoLogger): Database | Promise<Database>;
    metadata?: Record<string, unknown> | undefined;
}

export interface CacheFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: IDextoLogger): Cache | Promise<Cache>;
    metadata?: Record<string, unknown> | undefined;
}

export interface PluginFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): DextoPlugin;
    metadata?: Record<string, unknown> | undefined;
}

export interface CompactionFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): CompactionStrategy | Promise<CompactionStrategy>;
    metadata?: Record<string, unknown> | undefined;
}

export interface LoggerFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): IDextoLogger;
    metadata?: Record<string, unknown> | undefined;
}

export interface DextoImageModule {
    metadata: {
        name: string;
        version: string;
        description: string;
        target?: string;
        constraints?: string[];
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
