import { existsSync, readFileSync } from 'fs';
import { logger } from '@core/logger/index.js';
import { resolveBundledScript } from '@core/utils/path.js';
import { Registry, RegistrySchema, AgentRegistry } from './types.js';

/**
 * Local agent registry implementation
 */
export class LocalAgentRegistry implements AgentRegistry {
    private _registry: Registry | null = null;

    /**
     * Lazy load registry from JSON file
     */
    private getRegistry(): Registry {
        if (this._registry === null) {
            this._registry = this.loadRegistry();
        }
        return this._registry;
    }

    /**
     * Load registry from bundled JSON file
     */
    private loadRegistry(): Registry {
        let jsonPath: string;

        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            logger.error(`Failed to resolve agent registry path: ${error}`);
            return { version: '1.0.0', agents: {} };
        }

        if (!existsSync(jsonPath)) {
            logger.debug(`Agent registry not found at: ${jsonPath}`);
            return { version: '1.0.0', agents: {} };
        }

        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawRegistry = JSON.parse(jsonData);
            return RegistrySchema.parse(rawRegistry);
        } catch (error) {
            logger.error(`Failed to load registry from ${jsonPath}: ${error}`);
            return { version: '1.0.0', agents: {} };
        }
    }

    /**
     * Resolve an agent name/path to a config path
     */
    async resolveAgent(nameOrPath: string): Promise<string> {
        // For now, just throw - will implement in next task
        throw new Error('Not implemented yet');
    }
}
