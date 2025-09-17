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

export class InternalResourcesProvider implements ResourceProvider {
    private config: ValidatedInternalResourcesConfig;
    private handlers: Map<string, InternalResourceHandler> = new Map();
    private services: InternalResourceServices;

    constructor(config: ValidatedInternalResourcesConfig, services: InternalResourceServices = {}) {
        this.config = config;
        this.services = services;
        logger.debug('InternalResourcesProvider initialized with config:', config);
    }

    async initialize(): Promise<void> {
        if (!this.config.enabled || this.config.resources.length === 0) {
            logger.debug('Internal resources disabled or no resources configured');
            return;
        }

        for (const resourceConfig of this.config.resources) {
            try {
                const handler = createInternalResourceHandler(resourceConfig.type);
                const parsedConfig = InternalResourceConfigSchema.parse(resourceConfig);
                await handler.initialize(parsedConfig, this.services);
                this.handlers.set(resourceConfig.type, handler);
                logger.debug(`Initialized ${resourceConfig.type} resource handler`);
            } catch (error) {
                logger.error(`Failed to initialize ${resourceConfig.type} resource handler`, error);
            }
        }

        logger.debug(
            `InternalResourcesProvider initialized with ${this.handlers.size} resource handlers`
        );
    }

    getSource(): ResourceSource {
        return 'custom';
    }

    async listResources(): Promise<ResourceMetadata[]> {
        const allResources: ResourceMetadata[] = [];
        for (const [type, handler] of this.handlers.entries()) {
            try {
                const resources = await handler.listResources();
                allResources.push(...resources);
            } catch (error) {
                logger.error(
                    `Failed to list resources from ${type} handler: ${error instanceof Error ? error.message : String(error)}`,
                    error
                );
            }
        }
        return allResources;
    }

    async hasResource(uri: string): Promise<boolean> {
        for (const handler of this.handlers.values()) {
            if (handler.canHandle(uri)) return true;
        }
        return false;
    }

    async readResource(uri: string): Promise<ReadResourceResult> {
        for (const [type, handler] of this.handlers.entries()) {
            if (handler.canHandle(uri)) {
                try {
                    return await handler.readResource(uri);
                } catch (error) {
                    logger.error(
                        `Failed to read resource ${uri} from ${type} handler: ${error instanceof Error ? error.message : String(error)}`,
                        error
                    );
                    throw error;
                }
            }
        }
        throw new Error(`No handler found for resource: ${uri}`);
    }

    async refresh(): Promise<void> {
        for (const [type, handler] of this.handlers.entries()) {
            if (handler.refresh) {
                try {
                    await handler.refresh();
                    logger.debug(`Refreshed ${type} resource handler`);
                } catch (error) {
                    logger.error(
                        `Failed to refresh ${type} resource handler: ${error instanceof Error ? error.message : String(error)}`,
                        error
                    );
                }
            }
        }
    }

    invalidateCache(): void {
        logger.debug('Internal resources cache invalidated');
        for (const [type, handler] of this.handlers.entries()) {
            try {
                Promise.resolve(handler.refresh?.()).catch((err) =>
                    logger.error(`Failed to refresh ${type} resource handler`, err)
                );
            } catch (err) {
                logger.error(`Failed to schedule refresh for ${type} handler`, err);
            }
        }
    }

    getHandlers(): Map<string, InternalResourceHandler> {
        return this.handlers;
    }

    async addResourceConfig(config: InternalResourceConfig): Promise<void> {
        try {
            const handler = createInternalResourceHandler(config.type);
            const parsedConfig = InternalResourceConfigSchema.parse(config);
            await handler.initialize(parsedConfig, this.services);
            this.handlers.set(config.type, handler);
            this.config.resources.push(parsedConfig);
            logger.info(`Added new ${config.type} resource handler`);
        } catch (error) {
            logger.error(
                `Failed to add ${config.type} resource handler: ${error instanceof Error ? error.message : String(error)}`,
                error
            );
            throw error;
        }
    }

    async removeResourceHandler(type: string): Promise<void> {
        if (this.handlers.has(type)) {
            const handler = this.handlers.get(type);
            try {
                // Optional cleanup if supported by handler
                if (handler && typeof (handler as any).dispose === 'function') {
                    await (handler as any).dispose();
                }
            } catch (error) {
                logger.error(`Cleanup failed for ${type} resource handler`, error);
            }
            this.handlers.delete(type);
            this.config.resources = this.config.resources.filter((r) => r.type !== type);
            logger.info(`Removed ${type} resource handler`);
        }
    }

    /**
     * Get the blob service instance from the blob resource handler if available.
     */
    getBlobService(): import('../blob/index.js').BlobService | undefined {
        const blobHandler = this.handlers.get('blob');
        if (
            blobHandler &&
            'getBlobService' in blobHandler &&
            typeof blobHandler.getBlobService === 'function'
        ) {
            return blobHandler.getBlobService();
        }
        return undefined;
    }
}
