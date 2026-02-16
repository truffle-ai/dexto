import { ResourceProvider, ResourceMetadata, ResourceSource } from './types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { createInternalResourceHandler } from './handlers/factory.js';
import type { InternalResourceHandler, InternalResourceServices } from './handlers/types.js';
import type { ValidatedResourcesConfig, ValidatedResourceConfig } from './schemas.js';
import { ResourceConfigSchema } from './schemas.js';
import { ResourceError } from './errors.js';

export class AgentResourcesProvider implements ResourceProvider {
    private config: ValidatedResourcesConfig;
    private handlers: Map<string, InternalResourceHandler> = new Map();
    private services: InternalResourceServices;
    private logger: Logger;

    constructor(
        config: ValidatedResourcesConfig,
        services: InternalResourceServices,
        logger: Logger
    ) {
        this.config = [...config];
        this.services = services;
        this.logger = logger.createChild(DextoLogComponent.RESOURCE);
        this.logger.debug(
            `AgentResourcesProvider initialized with config: ${JSON.stringify(config)}`
        );
    }

    async initialize(): Promise<void> {
        if (this.config.length === 0) {
            this.logger.debug('No internal resources configured');
            return;
        }

        for (const resourceConfig of this.config) {
            try {
                const parsedConfig = ResourceConfigSchema.parse(resourceConfig);
                const handler = createInternalResourceHandler(
                    parsedConfig,
                    this.services,
                    this.logger
                );
                await handler.initialize(this.services);
                this.handlers.set(resourceConfig.type, handler);
                this.logger.debug(`Initialized ${resourceConfig.type} resource handler`);
            } catch (error) {
                this.logger.error(`Failed to initialize ${resourceConfig.type} resource handler`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        this.logger.debug(
            `AgentResourcesProvider initialized with ${this.handlers.size} resource handlers`
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
                this.logger.error(
                    `Failed to list resources from ${type} handler: ${error instanceof Error ? error.message : String(error)}`,
                    { error: error instanceof Error ? error.message : String(error) }
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
                    this.logger.error(
                        `Failed to read resource ${uri} from ${type} handler: ${error instanceof Error ? error.message : String(error)}`,
                        { error: error instanceof Error ? error.message : String(error) }
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
                    this.logger.debug(`Refreshed ${type} resource handler`);
                } catch (error) {
                    this.logger.error(
                        `Failed to refresh ${type} resource handler: ${error instanceof Error ? error.message : String(error)}`,
                        { error: error instanceof Error ? error.message : String(error) }
                    );
                }
            }
        }
    }

    async addResourceConfig(config: ValidatedResourceConfig): Promise<void> {
        try {
            const parsedConfig = ResourceConfigSchema.parse(config);
            const handler = createInternalResourceHandler(parsedConfig, this.services, this.logger);
            await handler.initialize(this.services);
            this.handlers.set(config.type, handler);
            this.config.push(parsedConfig);
            this.logger.info(`Added new ${config.type} resource handler`);
        } catch (error) {
            this.logger.error(
                `Failed to add ${config.type} resource handler: ${error instanceof Error ? error.message : String(error)}`,
                { error: error instanceof Error ? error.message : String(error) }
            );
            throw error;
        }
    }

    async removeResourceHandler(type: string): Promise<void> {
        if (this.handlers.has(type)) {
            this.handlers.delete(type);
            this.config = this.config.filter((r) => r.type !== type);
            this.logger.info(`Removed ${type} resource handler`);
        }
    }
}
