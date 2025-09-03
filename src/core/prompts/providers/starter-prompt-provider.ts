import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentConfig } from '../../agent/schemas.js';
import { logger } from '../../logger/index.js';

/**
 * Starter Prompt Provider - Provides prompts from agent configuration starter prompts
 *
 * This provider exposes starter prompts defined in the agent configuration as regular prompts.
 * Starter prompts are intended for quick access to common user workflows and are typically
 * displayed prominently in the UI.
 */
export class StarterPromptProvider implements PromptProvider {
    private starterPrompts: any[] = [];
    private promptsCache: PromptInfo[] = [];
    private cacheValid: boolean = false;

    constructor(agentConfig?: AgentConfig) {
        this.starterPrompts = agentConfig?.starterPrompts || [];
        this.buildPromptsCache();
    }

    /**
     * Get the source identifier for this provider
     */
    getSource(): string {
        return 'starter';
    }

    /**
     * Invalidate the prompts cache
     */
    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        logger.debug('StarterPromptProvider cache invalidated');
    }

    /**
     * Update starter prompts configuration
     */
    updateConfig(agentConfig?: AgentConfig): void {
        this.starterPrompts = agentConfig?.starterPrompts || [];
        this.invalidateCache();
        this.buildPromptsCache();
    }

    /**
     * Build the prompts cache from starter prompts configuration
     */
    private buildPromptsCache(): void {
        const allPrompts: PromptInfo[] = [];

        this.starterPrompts.forEach((starterPrompt: any) => {
            const promptName = `starter:${starterPrompt.id}`;
            const promptInfo: PromptInfo = {
                name: promptName,
                title: starterPrompt.title,
                description: starterPrompt.description,
                source: 'starter',
                metadata: {
                    prompt: starterPrompt.prompt,
                    category: starterPrompt.category,
                    icon: starterPrompt.icon,
                    priority: starterPrompt.priority,
                    originalId: starterPrompt.id,
                },
            };
            allPrompts.push(promptInfo);
        });

        this.promptsCache = allPrompts;
        this.cacheValid = true;

        logger.debug(`📝 Cached ${allPrompts.length} starter prompts`);
    }

    /**
     * List all available starter prompts with pagination support
     */
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            this.buildPromptsCache();
        }

        return {
            prompts: this.promptsCache,
        };
    }

    /**
     * Get a specific starter prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache.find((p) => p.name === name);
        if (!promptInfo) {
            throw new Error(`Starter prompt not found: ${name}`);
        }

        const promptText = promptInfo.metadata?.prompt as string;
        if (!promptText) {
            throw new Error('Starter prompt missing prompt text');
        }

        logger.debug(`📝 Reading starter prompt: ${name}`);

        // Apply arguments if provided (similar to internal provider)
        let content = promptText;
        if (args && typeof args === 'object') {
            if (args._context) {
                const contextString = String(args._context);
                content = `Context: ${contextString}\n\n${content}`;
            } else if (Object.keys(args).length > 0) {
                const argContext = Object.entries(args)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                content = `Arguments: ${argContext}\n\n${content}`;
            }
        }

        return {
            description: promptInfo.description,
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: content,
                    },
                },
            ],
        };
    }

    /**
     * Check if a starter prompt exists
     */
    async hasPrompt(name: string): Promise<boolean> {
        const prompts = await this.listPrompts();
        return prompts.prompts.some((prompt) => prompt.name === name);
    }

    /**
     * Get prompt definition (metadata only)
     */
    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        if (!this.cacheValid) {
            this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache.find((p) => p.name === name);
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
}
