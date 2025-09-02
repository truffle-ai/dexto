import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptListResult } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { InternalPromptProvider } from './providers/internal-prompt-provider.js';
import { logger } from '../logger/index.js';

/**
 * Unified Prompts Manager - Single interface for all prompt operations
 *
 * This class acts as the single point of contact for managing prompts from multiple sources.
 * It aggregates prompts from MCP servers and internal markdown files, providing a unified interface
 * for prompt discovery, metadata access, and prompt execution.
 *
 * Responsibilities:
 * - Aggregate prompts from MCP servers and internal markdown files
 * - Provide unified prompt interface for discovery and access
 * - Cache prompt metadata for performance
 * - Handle cross-source prompt conflicts with source prefixing
 * - Support filtering and querying of prompts
 * - Implement MCP-compliant prompt structure and pagination
 *
 * Architecture:
 * Application → PromptsManager → [MCPPromptProvider, InternalPromptProvider]
 */
export class PromptsManager {
    private mcpManager: MCPManager;
    private mcpPromptProvider: MCPPromptProvider;
    private internalPromptProvider: InternalPromptProvider;

    // Prompt caching for performance
    private promptsCache: PromptSet = {};
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager, promptsDir?: string) {
        this.mcpManager = mcpManager;

        // Initialize MCP prompt provider
        this.mcpPromptProvider = new MCPPromptProvider(mcpManager);

        // Initialize internal prompt provider
        this.internalPromptProvider = new InternalPromptProvider(promptsDir);

        logger.debug('PromptsManager initialized');
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
     * Invalidate the prompts cache
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = {};
        this.mcpPromptProvider.invalidateCache();
        this.internalPromptProvider.invalidateCache();
        logger.debug('PromptsManager cache invalidated');
    }

    /**
     * Build the unified prompts cache from all providers
     */
    private async buildPromptsCache(): Promise<void> {
        const allPrompts: PromptSet = {};

        // Get MCP prompts
        try {
            const mcpPromptsResult = await this.mcpPromptProvider.listPrompts();
            mcpPromptsResult.prompts.forEach((prompt) => {
                allPrompts[prompt.name] = prompt;
            });
            logger.debug(`📝 Cached ${mcpPromptsResult.prompts.length} MCP prompts`);
        } catch (error) {
            logger.error(
                `Failed to get MCP prompts: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Get internal prompts
        try {
            const internalPromptsResult = await this.internalPromptProvider.listPrompts();
            internalPromptsResult.prompts.forEach((prompt) => {
                allPrompts[prompt.name] = prompt;
            });
            logger.debug(`📝 Cached ${internalPromptsResult.prompts.length} internal prompts`);
        } catch (error) {
            logger.error(
                `Failed to get internal prompts: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        this.promptsCache = allPrompts;
        this.cacheValid = true;

        const totalPrompts = Object.keys(allPrompts).length;
        logger.debug(`📋 Prompt discovery: ${totalPrompts} total prompts`);

        if (totalPrompts > 0) {
            const sampleNames = Object.keys(allPrompts).slice(0, 5);
            logger.debug(
                `Sample prompts: ${sampleNames.join(', ')}${totalPrompts > 5 ? '...' : ''}`
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
    async getPromptsBySource(
        source: 'mcp' | 'internal'
    ): Promise<import('./types.js').PromptInfo[]> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        return Object.values(this.promptsCache).filter((prompt) => prompt.source === source);
    }

    /**
     * Search prompts by name or description
     */
    async searchPrompts(query: string): Promise<import('./types.js').PromptInfo[]> {
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
            throw new Error(`Prompt not found: ${name}`);
        }

        // Validate arguments if the prompt has defined arguments
        if (promptInfo.arguments && promptInfo.arguments.length > 0 && args) {
            this.validatePromptArguments(promptInfo.arguments, args);
        }

        // Route to appropriate provider
        if (promptInfo.source === 'mcp') {
            return await this.mcpPromptProvider.getPrompt(name, args);
        } else if (promptInfo.source === 'internal') {
            return await this.internalPromptProvider.getPrompt(name, args);
        } else {
            throw new Error(`Unknown prompt source: ${promptInfo.source}`);
        }
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
            const missingNames = missingRequired.map((arg) => arg.name).join(', ');
            throw new Error(`Missing required arguments: ${missingNames}`);
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
     * Get MCP prompt provider for direct access
     */
    getMCPProvider(): MCPPromptProvider {
        return this.mcpPromptProvider;
    }

    /**
     * Get internal prompt provider for direct access
     */
    getInternalProvider(): InternalPromptProvider {
        return this.internalPromptProvider;
    }
}
