import type { MCPManager } from '../../mcp/manager.js';
import type {
    PromptProvider,
    PromptInfo,
    PromptDefinition,
    PromptListResult,
    PromptArgument,
} from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logger/index.js';

/**
 * MCP Prompt Provider - Provides prompts from connected MCP servers
 *
 * This provider acts as a bridge between the PromptsManager and MCPManager,
 * exposing prompts from all connected MCP servers through a unified interface.
 * It implements the MCP specification for prompt discovery and retrieval.
 */
export class MCPPromptProvider implements PromptProvider {
    private mcpManager: MCPManager;

    // Prompt caching for performance
    private promptsCache: PromptInfo[] = [];
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager) {
        this.mcpManager = mcpManager;
    }

    /**
     * Get the source identifier for this provider
     */
    getSource(): string {
        return 'mcp';
    }

    /**
     * Invalidate the prompts cache
     */
    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        logger.debug('MCPPromptProvider cache invalidated');
    }

    /**
     * Build the prompts cache from MCP servers
     */
    private async buildPromptsCache(): Promise<void> {
        const allPrompts: PromptInfo[] = [];

        try {
            // Get all available prompt names
            const promptNames = await this.mcpManager.listAllPrompts();

            for (const promptName of promptNames) {
                try {
                    // Get the prompt definition to extract metadata
                    const promptDef = await this.mcpManager.getPrompt(promptName);

                    // Convert MCP prompt definition to our internal format
                    const args = (promptDef as { arguments?: PromptArgument[] }).arguments;
                    const promptInfo: PromptInfo = {
                        name: promptName,
                        title: promptDef.description || `MCP prompt: ${promptName}`,
                        description: promptDef.description || `MCP prompt: ${promptName}`,
                        ...(args && { arguments: args }),
                        source: 'mcp',
                        metadata: {
                            originalName: promptName,
                            description: promptDef.description,
                            messages: promptDef.messages,
                        },
                    };

                    allPrompts.push(promptInfo);
                } catch (error) {
                    logger.debug(
                        `Failed to get prompt definition for '${promptName}': ${error instanceof Error ? error.message : String(error)}`
                    );
                    // Still add the prompt with minimal info
                    allPrompts.push({
                        name: promptName,
                        title: `MCP prompt: ${promptName}`,
                        description: `MCP prompt: ${promptName}`,
                        source: 'mcp',
                        metadata: {
                            originalName: promptName,
                        },
                    });
                }
            }

            logger.debug(`📝 Cached ${allPrompts.length} MCP prompts`);
        } catch (error) {
            logger.error(
                `Failed to get MCP prompts: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        this.promptsCache = allPrompts;
        this.cacheValid = true;
    }

    /**
     * List all available prompts from MCP servers with pagination support
     */
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        // For now, return all prompts without pagination
        // TODO: Implement proper pagination when MCP servers support it
        return {
            prompts: this.promptsCache,
        };
    }

    /**
     * Get a specific prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        logger.debug(`📝 Reading MCP prompt: ${name}`);
        return await this.mcpManager.getPrompt(name, args);
    }

    /**
     * Check if a prompt exists
     */
    async hasPrompt(name: string): Promise<boolean> {
        const prompts = await this.listPrompts();
        return prompts.prompts.some((prompt) => prompt.name === name);
    }

    /**
     * Get prompt definition (metadata only)
     */
    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        try {
            const { prompts } = await this.listPrompts();
            const promptInfo = prompts.find((p) => p.name === name);
            if (!promptInfo) {
                return null;
            }

            return {
                name: promptInfo.name,
                ...(promptInfo.title && { title: promptInfo.title }),
                ...(promptInfo.description && { description: promptInfo.description }),
                ...(promptInfo.arguments && { arguments: promptInfo.arguments }),
            };
        } catch (error) {
            logger.debug(
                `Failed to get prompt definition for '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }
}
