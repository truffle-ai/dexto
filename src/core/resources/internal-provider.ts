import { ResourceProvider, ResourceMetadata, ResourceSource } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';
import {
    InternalResourceConfig,
    InternalResourceHandler,
    InternalResourceServices,
    createInternalResourceHandler,
} from './internal-registry.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';
import { InternalResourceConfigSchema } from './schemas.js';

/**
 * Internal Resources Provider
 *
 * Manages multiple types of internal resources using a registry system.
 * Similar to InternalToolsProvider but for resources.
 */
export class InternalResourcesProvider implements ResourceProvider {
    private config: ValidatedInternalResourcesConfig;
    private handlers: Map<string, InternalResourceHandler> = new Map();
    private services: InternalResourceServices;

    constructor(config: ValidatedInternalResourcesConfig, services: InternalResourceServices = {}) {
        this.config = config;
        this.services = services;
        logger.debug('InternalResourcesProvider initialized with config:', config);
    }

    /**
     * Initialize all configured resource handlers
     */
    async initialize(): Promise<void> {
        if (!this.config.enabled || this.config.resources.length === 0) {
            logger.debug('Internal resources disabled or no resources configured');
            return;
        }

        for (const resourceConfig of this.config.resources) {
            try {
                const handler = createInternalResourceHandler(resourceConfig.type);
                // Parse through schema to apply defaults
                const parsedConfig = InternalResourceConfigSchema.parse(resourceConfig);
                await handler.initialize(parsedConfig, this.services);
                this.handlers.set(resourceConfig.type, handler);
                logger.debug(`Initialized ${resourceConfig.type} resource handler`);
            } catch (error) {
                logger.error(
                    `Failed to initialize ${resourceConfig.type} resource handler`,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }

        const handlerCount = this.handlers.size;
        logger.debug(
            `InternalResourcesProvider initialized with ${handlerCount} resource handlers`
        );
    }

    getSource(): ResourceSource {
        return 'custom';
    }

    /**
     * List all resources from all handlers
     */
    async listResources(): Promise<ResourceMetadata[]> {
        const allResources: ResourceMetadata[] = [];

        for (const [type, handler] of this.handlers.entries()) {
            try {
                const resources = await handler.listResources();
                allResources.push(...resources);
            } catch (error) {
                logger.error(
                    `Failed to list resources from ${type} handler`,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }

        return allResources;
    }

    /**
     * Check if a resource exists by checking all handlers
     */
    async hasResource(uri: string): Promise<boolean> {
        for (const handler of this.handlers.values()) {
            if (handler.canHandle(uri)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Read a resource by finding the appropriate handler
     */
    async readResource(uri: string): Promise<ReadResourceResult> {
        for (const [type, handler] of this.handlers.entries()) {
            if (handler.canHandle(uri)) {
                try {
                    return await handler.readResource(uri);
                } catch (error) {
                    const normalized = error instanceof Error ? error : new Error(String(error));
                    logger.error(
                        `Failed to read resource ${uri} from ${type} handler: ${normalized.message}`,
                        normalized
                    );
                    throw normalized;
                }
            }
        }

        throw new Error(`No handler found for resource: ${uri}`);
    }

    /**
     * Refresh all handlers
     */
    async refresh(): Promise<void> {
        for (const [type, handler] of this.handlers.entries()) {
            if (handler.refresh) {
                try {
                    await handler.refresh();
                    logger.debug(`Refreshed ${type} resource handler`);
                } catch (error) {
                    logger.error(
                        `Failed to refresh ${type} resource handler`,
                        error instanceof Error ? error : new Error(String(error))
                    );
                }
            }
        }
    }

    /**
     * Invalidate cache (for consistency with existing API)
     */
    invalidateCache(): void {
        // Trigger refresh on next access
        // Individual handlers manage their own caching
        logger.debug('Internal resources cache invalidated');
    }

    /**
     * Get all active handlers
     */
    getHandlers(): Map<string, InternalResourceHandler> {
        return this.handlers;
    }

    /**
     * Add a new resource configuration dynamically
     */
    async addResourceConfig(config: InternalResourceConfig): Promise<void> {
        try {
            // If handler already exists, we could merge configs or replace
            const handler = createInternalResourceHandler(config.type);
            // Parse through schema to apply defaults
            const parsedConfig = InternalResourceConfigSchema.parse(config);
            await handler.initialize(parsedConfig, this.services);
            this.handlers.set(config.type, handler);

            // Add to stored config (store the parsed config with defaults)
            this.config.resources.push(parsedConfig);

            logger.info(`Added new ${config.type} resource handler`);
        } catch (error) {
            logger.error(
                `Failed to add ${config.type} resource handler`,
                error instanceof Error ? error : new Error(String(error))
            );
            throw error;
        }
    }

    /**
     * Remove a resource handler by type
     */
    async removeResourceHandler(type: string): Promise<void> {
        if (this.handlers.has(type)) {
            this.handlers.delete(type);

            // Remove from stored config
            this.config.resources = this.config.resources.filter((r) => r.type !== type);

            logger.info(`Removed ${type} resource handler`);
        }
    }
}
