import type { MCPManager } from '../../mcp/manager.js';
import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../logger/v2/types.js';

/**
 * MCP Prompt Provider - Provides prompts from connected MCP servers
 *
 * This provider acts as a bridge between the PromptManager and MCPManager,
 * exposing prompts from all connected MCP servers through a unified interface.
 * It leverages MCPManager's built-in prompt metadata cache for efficient access.
 */
export class MCPPromptProvider implements PromptProvider {
    private mcpManager: MCPManager;
    private logger: Logger;

    constructor(mcpManager: MCPManager, logger: Logger) {
        this.mcpManager = mcpManager;
        this.logger = logger;
    }

    /**
     * Get the source identifier for this provider
     */
    getSource(): string {
        return 'mcp';
    }

    /**
     * Invalidate the prompts cache (no-op as MCPManager handles caching)
     */
    invalidateCache(): void {
        // MCPManager handles cache invalidation through event notifications
        this.logger.debug('MCPPromptProvider cache invalidation (handled by MCPManager)');
    }

    /**
     * List all available prompts from MCP servers using MCPManager's cache
     */
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        const cachedPrompts = this.mcpManager.getAllPromptMetadata();

        const prompts: PromptInfo[] = cachedPrompts.map(
            ({ promptName, serverName, definition }) => {
                const promptInfo: PromptInfo = {
                    name: promptName,
                    displayName: promptName,
                    title:
                        definition.title || definition.description || `MCP prompt: ${promptName}`,
                    description: definition.description || `MCP prompt: ${promptName}`,
                    ...(definition.arguments && { arguments: definition.arguments }),
                    source: 'mcp',
                    metadata: {
                        serverName,
                        originalName: promptName,
                        ...definition,
                    },
                };
                return promptInfo;
            }
        );

        this.logger.debug(`📝 Listed ${prompts.length} MCP prompts from cache`);

        return {
            prompts,
        };
    }

    /**
     * Get a specific prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        this.logger.debug(`📝 Reading MCP prompt: ${name}`);
        return await this.mcpManager.getPrompt(name, args);
    }

    /**
     * Get prompt definition (metadata only) from MCPManager's cache
     */
    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        try {
            const definition = this.mcpManager.getPromptMetadata(name);
            if (!definition) {
                return null;
            }

            return {
                name: definition.name,
                ...(definition.title && { title: definition.title }),
                ...(definition.description && { description: definition.description }),
                ...(definition.arguments && { arguments: definition.arguments }),
            };
        } catch (error) {
            this.logger.debug(
                `Failed to get prompt definition for '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }
}
