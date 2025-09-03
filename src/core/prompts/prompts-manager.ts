import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptListResult, PromptProvider, PromptInfo } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentConfig } from '../agent/schemas.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { InternalPromptProvider } from './providers/internal-prompt-provider.js';
import { StarterPromptProvider } from './providers/starter-prompt-provider.js';
import { PromptError } from './errors.js';
import { logger } from '../logger/index.js';

/**
 * Unified Prompts Manager - Pure aggregator for prompt providers
 *
 * This class acts as a clean aggregator that delegates all operations to registered prompt providers.
 * It provides a unified interface for prompt discovery, metadata access, and prompt execution
 * across multiple prompt sources (MCP, internal, starter).
 *
 * Responsibilities:
 * - Register and manage prompt providers
 * - Aggregate prompts from all providers
 * - Provide unified prompt interface for discovery and access
 * - Cache aggregated prompt metadata for performance
 * - Handle cross-provider prompt conflicts with source prefixing
 * - Support filtering and querying of prompts
 *
 * Architecture:
 * Application → PromptsManager → [MCPPromptProvider, InternalPromptProvider, StarterPromptProvider]
 */
export class PromptsManager {
    private providers: Map<string, PromptProvider> = new Map();

    // Unified cache for all providers
    private promptsCache: PromptSet = {};
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager, promptsDir?: string, agentConfig?: AgentConfig) {
        // Register all prompt providers
        this.providers.set('mcp', new MCPPromptProvider(mcpManager));
        this.providers.set('internal', new InternalPromptProvider(promptsDir));
        this.providers.set('starter', new StarterPromptProvider(agentConfig));

        logger.debug(
            `PromptsManager initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`
        );
    }

    /**
     * Initialize the PromptsManager and its components
     */
    async initialize(): Promise<void> {
        // Initial cache build
        await this.buildPromptsCache();
        logger.debug('PromptsManager initialization complete');
    }

    /**
     * Invalidate the prompts cache for all providers
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = {};

        // Invalidate all provider caches
        for (const provider of this.providers.values()) {
            provider.invalidateCache();
        }

        logger.debug('PromptsManager cache invalidated');
    }

    /**
     * Build the unified prompts cache from all providers
     */
    private async buildPromptsCache(): Promise<void> {
        const allPrompts: PromptSet = {};
        let totalPromptsCount = 0;

        // Aggregate prompts from all registered providers
        for (const [providerName, provider] of this.providers) {
            try {
                const providerResult = await provider.listPrompts();
                const providerPrompts = providerResult.prompts;

                // Add each prompt to the unified cache
                providerPrompts.forEach((prompt) => {
                    allPrompts[prompt.name] = prompt;
                });

                totalPromptsCount += providerPrompts.length;
                logger.debug(
                    `📝 Cached ${providerPrompts.length} prompts from ${providerName} provider`
                );
            } catch (error) {
                logger.error(
                    `Failed to get prompts from ${providerName} provider: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.promptsCache = allPrompts;
        this.cacheValid = true;

        logger.debug(
            `📋 Prompt discovery: ${totalPromptsCount} total prompts from ${this.providers.size} providers`
        );

        if (totalPromptsCount > 0) {
            const sampleNames = Object.keys(allPrompts).slice(0, 5);
            logger.debug(
                `Sample prompts: ${sampleNames.join(', ')}${totalPromptsCount > 5 ? '...' : ''}`
            );
        }
    }

    /**
     * List all available prompts with their info
     */
    async list(): Promise<PromptSet> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }
        return this.promptsCache;
    }

    /**
     * Check if a prompt exists
     */
    async has(name: string): Promise<boolean> {
        const prompts = await this.list();
        return name in prompts;
    }

    /**
     * Check if a prompt exists (alias for has)
     */
    async hasPrompt(name: string): Promise<boolean> {
        return this.has(name);
    }

    /**
     * List all available prompts with pagination support
     */
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const prompts = Object.values(this.promptsCache);

        // For now, return all prompts without pagination
        // TODO: Implement proper pagination when needed
        return {
            prompts,
        };
    }

    /**
     * Get prompt definition (metadata only)
     */
    async getPromptDefinition(name: string): Promise<import('./types.js').PromptDefinition | null> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache[name];
        if (!promptInfo) {
            return null;
        }

        return {
            name: promptInfo.name,
            ...(promptInfo.title && { title: promptInfo.title }),
            ...(promptInfo.description && { description: promptInfo.description }),
            ...(promptInfo.arguments && { arguments: promptInfo.arguments }),
        };
    }

    /**
     * Get prompts by source
     */
    async getPromptsBySource(source: 'mcp' | 'internal' | 'starter'): Promise<PromptInfo[]> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        return Object.values(this.promptsCache).filter((prompt) => prompt.source === source);
    }

    /**
     * Search prompts by name or description
     */
    async searchPrompts(query: string): Promise<PromptInfo[]> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const searchTerm = query.toLowerCase();
        return Object.values(this.promptsCache).filter(
            (prompt) =>
                prompt.name.toLowerCase().includes(searchTerm) ||
                (prompt.description && prompt.description.toLowerCase().includes(searchTerm)) ||
                (prompt.title && prompt.title.toLowerCase().includes(searchTerm))
        );
    }

    /**
     * Get a specific prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache[name];
        if (!promptInfo) {
            throw PromptError.notFound(name);
        }

        // Validate arguments if the prompt has defined arguments
        if (promptInfo.arguments && promptInfo.arguments.length > 0) {
            this.validatePromptArguments(promptInfo.arguments, args || {});
        }

        // Find the provider that handles this prompt source
        const provider = this.providers.get(promptInfo.source);
        if (!provider) {
            throw PromptError.notFound(`No provider found for prompt source: ${promptInfo.source}`);
        }

        // Delegate to the appropriate provider
        return await provider.getPrompt(name, args);
    }

    /**
     * Validate prompt arguments against the prompt definition
     */
    private validatePromptArguments(
        expectedArgs: Array<{ name: string; required: boolean }>,
        providedArgs: Record<string, unknown>
    ): void {
        const missingRequired = expectedArgs
            .filter((arg) => arg.required)
            .filter((arg) => !(arg.name in providedArgs));

        if (missingRequired.length > 0) {
            const missingNames = missingRequired.map((arg) => arg.name);
            throw PromptError.missingRequiredArguments(missingNames);
        }

        // Check for unknown arguments
        const providedKeys = Object.keys(providedArgs);
        const expectedKeys = expectedArgs.map((arg) => arg.name);
        const unknownArgs = providedKeys.filter((key) => !expectedKeys.includes(key));

        if (unknownArgs.length > 0) {
            logger.warn(`Unknown arguments provided: ${unknownArgs.join(', ')}`);
        }
    }

    /**
     * Refresh all prompt caches
     */
    async refresh(): Promise<void> {
        this.invalidateCache();
        await this.buildPromptsCache();
        logger.info('PromptsManager refreshed');
    }

    /**
     * Get a specific provider by source name
     */
    getProvider(source: string): PromptProvider | undefined {
        return this.providers.get(source);
    }

    /**
     * Get all registered provider sources
     */
    getProviderSources(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Update starter prompts configuration (updates the starter provider)
     */
    updateStarterPrompts(agentConfig?: AgentConfig): void {
        const starterProvider = this.providers.get('starter') as StarterPromptProvider;
        if (starterProvider) {
            starterProvider.updateConfig(agentConfig);
            this.invalidateCache();
        }
    }
}
