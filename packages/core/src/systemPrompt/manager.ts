import type { ValidatedSystemPromptConfig, ValidatedContributorConfig } from './schemas.js';
import { StaticContributor, FileContributor, MemoryContributor } from './contributors.js';
import { getPromptGenerator } from './registry.js';
import type { MemoryManager } from '../memory/index.js';

import type { SystemPromptContributor, DynamicContributorContext } from './types.js';
import { DynamicContributor } from './contributors.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { SystemPromptError } from './errors.js';

/**
 * SystemPromptManager orchestrates registration, loading, and composition
 * of both static and dynamic system-prompt contributors.
 */
export class SystemPromptManager {
    private contributors: SystemPromptContributor[];
    private configDir: string;
    private memoryManager: MemoryManager;
    private logger: IDextoLogger;

    // TODO: move config dir logic somewhere else
    constructor(
        config: ValidatedSystemPromptConfig,
        configDir: string,
        memoryManager: MemoryManager | undefined,
        logger: IDextoLogger
    ) {
        this.configDir = configDir;
        this.memoryManager = memoryManager as MemoryManager;
        this.logger = logger.createChild(DextoLogComponent.SYSTEM_PROMPT);
        this.logger.debug(`[SystemPromptManager] Initializing with configDir: ${configDir}`);

        // Filter enabled contributors and create contributor instances
        const enabledContributors = config.contributors.filter((c) => c.enabled !== false);

        this.contributors = enabledContributors
            .map((config) => this.createContributor(config))
            .sort((a, b) => a.priority - b.priority); // Lower priority number = higher priority
    }

    private createContributor(config: ValidatedContributorConfig): SystemPromptContributor {
        switch (config.type) {
            case 'static':
                return new StaticContributor(config.id, config.priority, config.content);

            case 'dynamic': {
                const promptGenerator = getPromptGenerator(config.source);
                if (!promptGenerator) {
                    throw SystemPromptError.unknownContributorSource(config.source);
                }
                return new DynamicContributor(config.id, config.priority, promptGenerator);
            }

            case 'file': {
                this.logger.debug(
                    `[SystemPromptManager] Creating FileContributor "${config.id}" with files: ${JSON.stringify(config.files)}`
                );
                return new FileContributor(
                    config.id,
                    config.priority,
                    config.files,
                    config.options,
                    this.logger
                );
            }

            case 'memory': {
                if (!this.memoryManager) {
                    throw SystemPromptError.unknownContributorSource(
                        'memory (MemoryManager not provided)'
                    );
                }
                this.logger.debug(
                    `[SystemPromptManager] Creating MemoryContributor "${config.id}" with options: ${JSON.stringify(config.options)}`
                );
                return new MemoryContributor(
                    config.id,
                    config.priority,
                    this.memoryManager,
                    config.options,
                    this.logger
                );
            }

            default: {
                // Exhaustive check - TypeScript will error if we miss a case
                const _exhaustive: never = config;
                throw SystemPromptError.invalidContributorConfig(_exhaustive);
            }
        }
    }

    /**
     * Build the full system prompt by invoking each contributor and concatenating.
     */
    async build(ctx: DynamicContributorContext): Promise<string> {
        const parts = await Promise.all(
            this.contributors.map(async (contributor) => {
                const content = await contributor.getContent(ctx);
                this.logger.debug(
                    `[SystemPrompt] Contributor "${contributor.id}" provided content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
                );
                return content;
            })
        );
        return parts.join('\n');
    }

    /**
     * Expose current list of contributors (for inspection or testing).
     */
    getContributors(): SystemPromptContributor[] {
        return this.contributors;
    }
}
