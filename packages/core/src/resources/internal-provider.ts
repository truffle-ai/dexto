import { ResourceProvider, ResourceMetadata, ResourceSource } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';
import { createInternalResourceHandler } from './handlers/factory.js';
import type { InternalResourceHandler, InternalResourceServices } from './handlers/types.js';
import type {
    ValidatedInternalResourcesConfig,
    ValidatedInternalResourceConfig,
} from './schemas.js';
import { InternalResourceConfigSchema } from './schemas.js';
import { ResourceError } from './errors.js';

export class InternalResourcesProvider implements ResourceProvider {
    private config: ValidatedInternalResourcesConfig;
    private handlers: Map<string, InternalResourceHandler> = new Map();
    private services: InternalResourceServices;

    constructor(config: ValidatedInternalResourcesConfig, services: InternalResourceServices) {
        this.config = config;
        this.services = services;
        logger.debug(
            `InternalResourcesProvider initialized with config: ${JSON.stringify(config)}`
        );
    }

    async initialize(): Promise<void> {
        if (!this.config.enabled || this.config.resources.length === 0) {
            logger.debug('Internal resources disabled or no resources configured');
            return;
        }

        for (const resourceConfig of this.config.resources) {
            try {
                const parsedConfig = InternalResourceConfigSchema.parse(resourceConfig);
                const handler = createInternalResourceHandler(parsedConfig, this.services);
                await handler.initialize(this.services);
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
        return 'internal';
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
        throw ResourceError.noSuitableProvider(uri);
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

    async addResourceConfig(config: ValidatedInternalResourceConfig): Promise<void> {
        try {
            const parsedConfig = InternalResourceConfigSchema.parse(config);
            const handler = createInternalResourceHandler(parsedConfig, this.services);
            await handler.initialize(this.services);
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
            this.handlers.delete(type);
            this.config.resources = this.config.resources.filter((r) => r.type !== type);
            logger.info(`Removed ${type} resource handler`);
        }
    }
}
