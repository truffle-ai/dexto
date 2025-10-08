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
        // TODO: (355) Nit: incorrect use of logger args. See if we can make a linter rule for this.
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413189928
        logger.debug('InternalResourcesProvider initialized with config:', config);
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
        // TODO: (355) Throw a typed error instead
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413187597
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

    async addResourceConfig(config: InternalResourceConfig): Promise<void> {
        try {
            const parsedConfig = InternalResourceConfigSchema.parse(config);
            const handler = createInternalResourceHandler(parsedConfig, this.services);
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
            // TODO: (355) None of the handlers' support this and it's not mentioned in the interface either. Can delete this try catch block entirely
            // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413253688
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
}
