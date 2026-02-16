import type {
    BlobStore,
    Cache,
    Database,
    Hook,
    Logger,
    CompactionStrategy as CompactionStrategy,
    Tool,
} from '@dexto/core';
import type { z } from 'zod';
import type { AgentConfig } from '../schemas/agent-config.js';

/**
 * Image defaults are a partial, *unvalidated* agent config that is merged into the raw YAML config
 * before schema validation.
 *
 * Merge semantics are implemented by `applyImageDefaults()`:
 * - shallow merge at the top-level (config wins)
 * - object fields merge 1-level deep
 * - arrays are atomic (fully replaced; no concatenation) except `prompts`, which are merged to
 *   avoid accidentally dropping image-provided prompts when an agent config defines its own prompts
 */
export type ImageDefaults = Partial<AgentConfig>;

/**
 * Optional tool metadata for UIs and discovery.
 */
export interface ToolFactoryMetadata {
    displayName: string;
    description: string;
    category: string;
}

/**
 * Tool factories are keyed by `type` in the agent config (`tools: [{ type: "..." }]`).
 *
 * A single factory entry can produce multiple tools, which is useful for "tool packs" where a single
 * config block enables a related set of tools (e.g., filesystem tools: read/write/edit/glob/grep).
 */
export interface ToolFactory<TConfig = unknown> {
    /** Zod schema for validating factory-specific configuration. */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    /** Create one or more tool instances from validated config. */
    create(config: TConfig): Tool[];
    metadata?: ToolFactoryMetadata;
}

/**
 * Storage factories are keyed by `type` in the agent config (`storage.blob.type`, etc.).
 *
 * Factories may return a Promise to support lazy optional dependencies (e.g., sqlite/pg/redis).
 */
export interface BlobStoreFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: Logger): BlobStore | Promise<BlobStore>;
    metadata?: Record<string, unknown> | undefined;
}

export interface DatabaseFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: Logger): Database | Promise<Database>;
    metadata?: Record<string, unknown> | undefined;
}

export interface CacheFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig, logger: Logger): Cache | Promise<Cache>;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Hook factories are keyed by `type` in the agent config (`hooks: [{ type: "..." }]`).
 */
export interface HookFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): Hook;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Compaction factories are keyed by `type` in the agent config (`compaction.type`).
 */
export interface CompactionFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): CompactionStrategy | Promise<CompactionStrategy>;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Logger factory used by the agent to create its logger instance.
 *
 * This remains a factory (vs a map) because an agent should have a single logger implementation.
 */
export interface LoggerFactory<TConfig = unknown> {
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    create(config: TConfig): Logger;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * An image is a typed module that bundles defaults and a set of factories that a host (CLI/server/app)
 * may use to resolve config → concrete instances.
 *
 * Key design constraints:
 * - No global registries; the image object itself is the lookup table (Record access by `type`)
 * - Factories are plain exports; resolution is explicit and testable
 * - Hosts decide how to load images (static import, dynamic import via `loadImage()`, allowlists, etc.)
 */
export interface DextoImageModule {
    /**
     * Metadata about the image package.
     *
     * `target`/`constraints` are free-form strings. Hosts may interpret these for UX/allowlisting
     * but they have no built-in semantics in core.
     */
    metadata: {
        name: string;
        version: string;
        description: string;
        target?: string;
        constraints?: string[];
    };
    defaults?: ImageDefaults;
    /**
     * Tool factories keyed by config `type`.
     * Example: `{ "filesystem-tools": fileSystemToolsFactory }`.
     */
    tools: Record<string, ToolFactory>;
    /**
     * Storage factories keyed by config `type`.
     */
    storage: {
        blob: Record<string, BlobStoreFactory>;
        database: Record<string, DatabaseFactory>;
        cache: Record<string, CacheFactory>;
    };
    hooks: Record<string, HookFactory>;
    compaction: Record<string, CompactionFactory>;
    logger: LoggerFactory;
}
