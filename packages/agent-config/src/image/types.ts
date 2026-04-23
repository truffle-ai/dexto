import type {
    BlobStore,
    Cache,
    DextoAgentConfigInput,
    Database,
    Hook,
    Logger,
    CompactionStrategy as CompactionStrategy,
    Tool,
} from '@dexto/core';
import type { z } from 'zod';
import type { AgentConfig, ValidatedAgentConfig } from '../schemas/agent-config.js';

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
 * Optional host-owned context that can influence image/service resolution in hosted runtimes.
 *
 * This stays generic on purpose: hosts may pass clients, capability flags, and runtime metadata
 * without changing the public agent YAML shape.
 */
export interface DextoHostContext<
    TRuntime extends object = object,
    TCapabilities extends object = object,
    TClients extends object = object,
> {
    mode?: 'local' | 'server' | 'hosted';
    sessionId?: string;
    workspaceId?: string;
    runId?: string;
    attemptId?: string;
    clients?: TClients;
    capabilities?: TCapabilities;
    runtime?: TRuntime;
}

/**
 * Shared resolver context passed to image factories.
 */
export interface ImageResolutionContext<THostContext extends DextoHostContext = DextoHostContext> {
    agentId: string;
    hostContext?: THostContext | undefined;
}

/**
 * Optional runtime-setting overrides an image may derive from validated config + host context.
 *
 * This lets hosted images adapt LLM/MCP-facing settings without changing the YAML surface.
 */
export type DextoImageRuntimeConfigOverrides = Partial<Omit<DextoAgentConfigInput, 'agentId'>>;

export interface ResolveImageRuntimeConfigOptions<
    THostContext extends DextoHostContext = DextoHostContext,
> {
    config: ValidatedAgentConfig;
    context: ImageResolutionContext<THostContext>;
}

/**
 * Tool factories are keyed by `type` in the agent config (`tools: [{ type: "..." }]`).
 *
 * A single factory entry can produce multiple tools, which is useful for "tool packs" where a single
 * config block enables a related set of tools (e.g., filesystem tools: read/write/edit/glob/grep).
 */
export interface ToolFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    /** Zod schema for validating factory-specific configuration. */
    configSchema: z.ZodType<TConfig, unknown>;
    /** Create one or more tool instances from validated config. */
    create(config: TConfig, context?: ImageResolutionContext<THostContext>): Tool[];
    metadata?: ToolFactoryMetadata;
}

/**
 * Storage factories are keyed by `type` in the agent config (`storage.blob.type`, etc.).
 *
 * Factories may return a Promise to support lazy optional dependencies (e.g., sqlite/pg/redis).
 */
export interface BlobStoreFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(
        config: TConfig,
        logger: Logger,
        context?: ImageResolutionContext<THostContext>
    ): BlobStore | Promise<BlobStore>;
    metadata?: Record<string, unknown> | undefined;
}

export interface DatabaseFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(
        config: TConfig,
        logger: Logger,
        context?: ImageResolutionContext<THostContext>
    ): Database | Promise<Database>;
    metadata?: Record<string, unknown> | undefined;
}

export interface CacheFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(
        config: TConfig,
        logger: Logger,
        context?: ImageResolutionContext<THostContext>
    ): Cache | Promise<Cache>;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Hook factories are keyed by `type` in the agent config (`hooks: [{ type: "..." }]`).
 */
export interface HookFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(config: TConfig, context?: ImageResolutionContext<THostContext>): Hook;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Compaction factories are keyed by `type` in the agent config (`compaction.type`).
 */
export interface CompactionFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(
        config: TConfig,
        context?: ImageResolutionContext<THostContext>
    ): CompactionStrategy | Promise<CompactionStrategy>;
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Logger factory used by the agent to create its logger instance.
 *
 * This remains a factory (vs a map) because an agent should have a single logger implementation.
 */
export interface LoggerFactory<
    TConfig = unknown,
    THostContext extends DextoHostContext = DextoHostContext,
> {
    configSchema: z.ZodType<TConfig, unknown>;
    create(config: TConfig, context?: ImageResolutionContext<THostContext>): Logger;
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
export interface DextoImage<THostContext extends DextoHostContext = DextoHostContext> {
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
    tools: Record<string, ToolFactory<unknown, THostContext>>;
    /**
     * Storage factories keyed by config `type`.
     */
    storage: {
        blob: Record<string, BlobStoreFactory<unknown, THostContext>>;
        database: Record<string, DatabaseFactory<unknown, THostContext>>;
        cache: Record<string, CacheFactory<unknown, THostContext>>;
    };
    hooks: Record<string, HookFactory<unknown, THostContext>>;
    compaction: Record<string, CompactionFactory<unknown, THostContext>>;
    logger: LoggerFactory<unknown, THostContext>;
    resolveRuntimeConfig?(
        options: ResolveImageRuntimeConfigOptions<THostContext>
    ): DextoImageRuntimeConfigOverrides | undefined;
}
