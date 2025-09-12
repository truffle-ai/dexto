import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptListResult, PromptProvider, PromptInfo } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentConfig } from '../agent/schemas.js';
import type { AgentEventBus } from '../events/index.js';
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
    private aliasMap = new Map<string, { baseName: string; providerName: string }>();
    private buildPromise: Promise<void> | null = null;

    constructor(
        mcpManager: MCPManager,
        promptsDir?: string,
        agentConfig?: AgentConfig,
        private eventBus?: AgentEventBus
    ) {
        // Register all prompt providers
        this.providers.set('mcp', new MCPPromptProvider(mcpManager));
        this.providers.set('internal', new InternalPromptProvider(promptsDir));
        this.providers.set('starter', new StarterPromptProvider(agentConfig));

        logger.debug(
            `PromptsManager initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`
        );

        // If an event bus is provided and supports subscriptions, subscribe to MCP-related events
        if (this.eventBus && typeof (this.eventBus as any).on === 'function') {
            const refresh = async (reason: string) => {
                logger.debug(`PromptsManager refreshing due to: ${reason}`);
                await this.refresh();
            };

            this.eventBus.on('dexto:mcpServerConnected', async (p) => {
                if (p.success) {
                    await refresh(`mcpServerConnected:${p.name}`);
                }
            });
            this.eventBus.on('dexto:mcpServerRemoved', async (p) => {
                await refresh(`mcpServerRemoved:${p.serverName}`);
            });
            this.eventBus.on('dexto:mcpServerUpdated', async (p) => {
                await refresh(`mcpServerUpdated:${p.serverName}`);
            });
        } else if (this.eventBus) {
            logger.debug(
                'PromptsManager received an event bus without subscription methods; skipping event subscriptions'
            );
        }
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
        this.aliasMap.clear();
        this.buildPromise = null; // Clear any in-flight build promise

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
        // If a build is already in progress, wait for it to complete
        if (this.buildPromise) {
            return this.buildPromise;
        }

        // Create a new build promise
        this.buildPromise = this._buildPromptsCache();
        try {
            await this.buildPromise;
        } finally {
            this.buildPromise = null;
        }
    }

    /**
     * Internal method to actually build the prompts cache
     */
    private async _buildPromptsCache(): Promise<void> {
        const allPrompts: PromptSet = {};
        let totalPromptsCount = 0;

        // Aggregate prompts from all registered providers
        for (const [providerName, provider] of this.providers) {
            try {
                const { prompts: providerPrompts } = await provider.listPrompts();

                providerPrompts.forEach((p) => {
                    const baseName = p.name;
                    let name = baseName;
                    if (allPrompts[baseName] && allPrompts[baseName].source !== p.source) {
                        name = `${providerName}:${baseName}`;
                        logger.warn(
                            `⚠️ Prompt name conflict for '${baseName}'. Prefixed as '${name}'.`
                        );
                        // Store the alias mapping for provider lookups
                        this.aliasMap.set(name, { baseName, providerName });
                    }
                    allPrompts[name] = name === baseName ? p : { ...p, name };
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

        // Return sanitized copies to avoid exposing sensitive metadata
        const sanitizedCache: PromptSet = {};
        for (const [name, prompt] of Object.entries(this.promptsCache)) {
            sanitizedCache[name] = this.sanitizePromptMetadata(prompt);
        }
        return sanitizedCache;
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

        const prompts = Object.values(this.promptsCache).map((prompt) =>
            this.sanitizePromptMetadata(prompt)
        );

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

        return Object.values(this.promptsCache)
            .filter((prompt) => prompt.source === source)
            .map((p) => this.sanitizePromptMetadata(p));
    }

    /**
     * Search prompts by name or description
     */
    async searchPrompts(query: string): Promise<PromptInfo[]> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const searchTerm = query.toLowerCase();
        const results = Object.values(this.promptsCache).filter(
            (prompt) =>
                prompt.name.toLowerCase().includes(searchTerm) ||
                (prompt.description && prompt.description.toLowerCase().includes(searchTerm)) ||
                (prompt.title && prompt.title.toLowerCase().includes(searchTerm))
        );
        return results.map((p) => this.sanitizePromptMetadata(p));
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
            throw PromptError.providerNotFound(promptInfo.source);
        }

        // Get the original name for provider lookup (handle aliases)
        const originalName = this.aliasMap.get(name)?.baseName || name;

        // Delegate to the appropriate provider
        return await provider.getPrompt(originalName, args);
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
     * Sanitize prompt metadata to remove sensitive information
     */
    private sanitizePromptMetadata(prompt: PromptInfo): PromptInfo {
        const {
            content: _content,
            prompt: _promptText,
            filePath: _filePath,
            ...safeMetadata
        } = prompt.metadata || {};

        if (Object.keys(safeMetadata).length === 0) {
            // If no safe metadata remains, omit the metadata property entirely
            const { metadata: _metadata, ...promptWithoutMetadata } = prompt;
            return promptWithoutMetadata;
        }

        return { ...prompt, metadata: safeMetadata };
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
