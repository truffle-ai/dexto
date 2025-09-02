import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet } from './types.js';
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
            const mcpPrompts = await this.mcpPromptProvider.listPrompts();
            mcpPrompts.forEach((prompt) => {
                allPrompts[prompt.name] = prompt;
            });
            logger.debug(`📝 Cached ${mcpPrompts.length} MCP prompts`);
        } catch (error) {
            logger.error(
                `Failed to get MCP prompts: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Get internal prompts
        try {
            const internalPrompts = await this.internalPromptProvider.listPrompts();
            internalPrompts.forEach((prompt) => {
                allPrompts[prompt.name] = prompt;
            });
            logger.debug(`📝 Cached ${internalPrompts.length} internal prompts`);
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
     * Get a specific prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const prompts = await this.list();
        const metadata = prompts[name];
        if (!metadata) {
            throw new Error(`Prompt not found: ${name}`);
        }

        logger.debug(`📝 Getting prompt: ${name}`);

        // Route to appropriate provider based on source
        if (metadata.source === 'mcp') {
            return await this.mcpPromptProvider.getPrompt(name, args);
        }

        if (metadata.source === 'internal') {
            return await this.internalPromptProvider.getPrompt(name, args);
        }

        throw new Error(`No provider found for prompt: ${name}`);
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
    getMcpPromptProvider(): MCPPromptProvider {
        return this.mcpPromptProvider;
    }

    /**
     * Get internal prompt provider for direct access
     */
    getInternalPromptProvider(): InternalPromptProvider {
        return this.internalPromptProvider;
    }
}
