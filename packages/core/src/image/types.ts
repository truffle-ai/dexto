/**
 * Dexto Base Image Definition
 *
 * Base images are pre-configured backend surfaces that bundle providers,
 * utilities, and defaults for specific deployment targets.
 *
 * Like Alpine Linux or Ubuntu, but for AI agents.
 */

import type { z } from 'zod';

/**
 * Generic provider interface that all provider types should extend.
 * Provides common structure for type-safe provider registration.
 *
 * Note: This is a simplified interface for image definitions.
 * Actual provider implementations should use the specific provider
 * interfaces from their respective modules (e.g., BlobStoreProvider).
 */
export interface ImageProvider<TType extends string = string> {
    /** Unique type identifier for this provider (e.g., 'sqlite', 'local', 's3') */
    type: TType;
    /** Zod schema for validating provider configuration */
    configSchema: z.ZodType<any>;
    /** Factory function to create provider instance */
    create: (config: any, deps: any) => any;
    /** Optional metadata about the provider */
    metadata?: ProviderMetadata;
}

/**
 * Metadata about a provider's characteristics and requirements
 */
export interface ProviderMetadata {
    /** Human-readable display name */
    displayName?: string;
    /** Brief description of what this provider does */
    description?: string;
    /** Whether this provider requires network connectivity */
    requiresNetwork?: boolean;
    /** Whether this provider requires filesystem access */
    requiresFilesystem?: boolean;
    /** Persistence level of storage providers */
    persistenceLevel?: 'ephemeral' | 'persistent';
    /** Platforms this provider is compatible with */
    platforms?: ('node' | 'browser' | 'edge' | 'worker')[];
}

/**
 * Registry function that registers providers on module initialization.
 * Called automatically when the image is imported.
 */
export type ProviderRegistrationFn = () => void | Promise<void>;

/**
 * Configuration for a single provider category in an image.
 * Supports both direct provider objects and registration functions.
 */
export interface ProviderCategoryConfig {
    /** Direct provider objects to register */
    providers?: ImageProvider[];
    /** Registration function for complex initialization */
    register?: ProviderRegistrationFn;
}

/**
 * Complete image definition structure.
 * This is what dexto.image.ts exports.
 */
export interface ImageDefinition {
    /** Unique name for this image (e.g., 'local', 'cloud', 'edge') */
    name: string;
    /** Semantic version of this image */
    version: string;
    /** Brief description of this image's purpose and target environment */
    description: string;
    /** Target deployment environment (for documentation and validation) */
    target?: ImageTarget;

    /**
     * Provider categories to register.
     * Each category can include direct providers or a registration function.
     */
    providers: {
        /** Blob storage providers (e.g., local filesystem, S3, R2) */
        blobStore?: ProviderCategoryConfig;
        /** Database providers (e.g., SQLite, PostgreSQL, D1) */
        database?: ProviderCategoryConfig;
        /** Cache providers (e.g., in-memory, Redis, KV) */
        cache?: ProviderCategoryConfig;
        /** Custom tool providers (e.g., datetime helpers, API integrations) */
        customTools?: ProviderCategoryConfig;
        /** Plugin providers (e.g., audit logging, content filtering) */
        plugins?: ProviderCategoryConfig;
        /** Compression strategy providers (e.g., sliding window, summarization) */
        compression?: ProviderCategoryConfig;
    };

    /**
     * Default configuration values.
     * Used when agent config doesn't specify values.
     * Merged with agent config during agent creation.
     */
    defaults?: ImageDefaults;

    /**
     * Runtime constraints this image requires.
     * Used for validation and error messages.
     */
    constraints?: ImageConstraint[];

    /**
     * Utilities exported by this image.
     * Maps utility name to file path (relative to image root).
     *
     * Example:
     * {
     *   configEnrichment: './utils/config.js',
     *   lifecycle: './utils/lifecycle.js'
     * }
     */
    utils?: Record<string, string>;

    /**
     * Selective named exports from packages.
     * Allows re-exporting specific types and values from dependencies.
     *
     * Example:
     * {
     *   '@dexto/core': ['logger', 'createAgentCard', 'type DextoAgent'],
     *   '@dexto/utils': ['formatDate', 'parseConfig']
     * }
     */
    exports?: Record<string, string[]>;

    /**
     * Parent image to extend (for image inheritance).
     * Optional: enables creating specialized images from base images.
     */
    extends?: string;

    /**
     * Bundled plugin paths.
     * Absolute paths to plugin directories containing .dexto-plugin or .claude-plugin manifests.
     * These plugins are automatically discovered alongside user/project plugins.
     *
     * Example:
     * ```typescript
     * import { PLUGIN_PATH as planToolsPluginPath } from '@dexto/tools-plan';
     *
     * bundledPlugins: [planToolsPluginPath]
     * ```
     */
    bundledPlugins?: string[];
}

/**
 * Target deployment environments for images.
 * Helps users choose the right image for their use case.
 */
export type ImageTarget =
    | 'local-development'
    | 'cloud-production'
    | 'edge-serverless'
    | 'embedded-iot'
    | 'enterprise'
    | 'custom';

/**
 * Runtime constraints that an image requires.
 * Used for validation and helpful error messages.
 */
export type ImageConstraint =
    | 'filesystem-required'
    | 'network-required'
    | 'offline-capable'
    | 'serverless-compatible'
    | 'cold-start-optimized'
    | 'low-memory'
    | 'edge-compatible'
    | 'browser-compatible';

/**
 * Default configuration values provided by an image.
 * These are used when agent config doesn't specify values.
 */
export interface ImageDefaults {
    /** Default storage configuration */
    storage?: {
        database?: {
            type: string;
            [key: string]: any;
        };
        blob?: {
            type: string;
            [key: string]: any;
        };
        cache?: {
            type: string;
            [key: string]: any;
        };
    };
    /** Default logging configuration */
    logging?: {
        level?: 'debug' | 'info' | 'warn' | 'error';
        fileLogging?: boolean;
        [key: string]: any;
    };
    /** Default LLM configuration */
    llm?: {
        provider?: string;
        model?: string;
        [key: string]: any;
    };
    /** Default tool configuration */
    tools?: {
        internalTools?: string[];
        [key: string]: any;
    };
    /** Other default values */
    [key: string]: any;
}

/**
 * Metadata about a built image (generated by bundler).
 * Included in the compiled image output.
 */
export interface ImageMetadata {
    /** Image name */
    name: string;
    /** Image version */
    version: string;
    /** Description */
    description: string;
    /** Target environment */
    target?: ImageTarget;
    /** Runtime constraints */
    constraints: ImageConstraint[];
    /** Build timestamp */
    builtAt: string;
    /** Core version this image was built for */
    coreVersion: string;
    /** Base image this extends (if any) */
    extends?: string;
}

/**
 * Result of building an image.
 * Contains the generated code and metadata.
 */
export interface ImageBuildResult {
    /** Generated JavaScript code for the image entry point */
    code: string;
    /** Generated TypeScript definitions */
    types: string;
    /** Image metadata */
    metadata: ImageMetadata;
    /** Warnings encountered during build */
    warnings?: string[];
}

/**
 * Options for building an image.
 */
export interface ImageBuildOptions {
    /** Path to dexto.image.ts file */
    imagePath: string;
    /** Output directory for built image */
    outDir: string;
    /** Whether to generate source maps */
    sourcemap?: boolean;
    /** Whether to minify output */
    minify?: boolean;
    /** Additional validation rules */
    strict?: boolean;
}
