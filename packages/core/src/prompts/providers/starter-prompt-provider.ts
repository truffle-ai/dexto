import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';
import { logger } from '../../logger/index.js';
import { PromptError } from '../errors.js';

type StarterPromptItem = ValidatedAgentConfig['starterPrompts'][number];

/**
 * Starter Prompt Provider - Provides prompts from agent configuration starter prompts
 *
 * This provider exposes starter prompts defined in the agent configuration as regular prompts.
 * Starter prompts are intended for quick access to common user workflows and are typically
 * displayed prominently in the UI.
 */
export class StarterPromptProvider implements PromptProvider {
    // Sourced from validated AgentConfig schema's starterPrompts
    private starterPrompts: StarterPromptItem[] = [];
    private promptsCache: PromptInfo[] = [];
    private cacheValid: boolean = false;

    constructor(agentConfig: ValidatedAgentConfig) {
        // Starter prompts come from the validated AgentConfig schema
        this.starterPrompts = agentConfig.starterPrompts;
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
    updateConfig(agentConfig: ValidatedAgentConfig): void {
        this.starterPrompts = agentConfig.starterPrompts;
        this.invalidateCache();
        this.buildPromptsCache();
    }

    /**
     * Build the prompts cache from starter prompts configuration
     */
    private buildPromptsCache(): void {
        const allPrompts: PromptInfo[] = [];

        this.starterPrompts.forEach((starterPrompt: StarterPromptItem) => {
            const promptName = `starter:${starterPrompt.id}`;
            const promptInfo: PromptInfo = {
                name: promptName,
                title: starterPrompt.title,
                description: starterPrompt.description,
                source: 'starter',
                metadata: {
                    prompt: starterPrompt.prompt,
                    category: starterPrompt.category,
                    priority: starterPrompt.priority,
                    originalId: starterPrompt.id,
                },
            };
            allPrompts.push(promptInfo);
        });

        // Sort by priority (higher numbers first) to respect schema semantics
        const getPriority = (p: PromptInfo): number => {
            const val = p.metadata?.priority as unknown;
            return typeof val === 'number' ? val : 0;
        };
        allPrompts.sort((a, b) => getPriority(b) - getPriority(a));
        this.promptsCache = allPrompts;
        this.cacheValid = true;

        logger.debug(`📝 Cached ${allPrompts.length} starter prompts`);
    }

    /**
     * List all available starter prompts
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
            throw PromptError.notFound(name);
        }

        const rawPrompt = promptInfo.metadata?.prompt;
        if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
            throw PromptError.missingText();
        }
        const promptText = rawPrompt;

        logger.debug(`📝 Reading starter prompt: ${name}`);

        // Apply arguments if provided: append at END when no placeholders are used
        let content = promptText;
        if (args && typeof args === 'object') {
            const hasPositionalPlaceholders =
                /\$[1-9]/.test(content) || content.includes('$ARGUMENTS');
            if (!hasPositionalPlaceholders) {
                if ((args as any)._context) {
                    const contextString = String((args as any)._context);
                    content = `${content}\n\nContext: ${contextString}`;
                } else {
                    const argEntries = Object.entries(args).filter(([k]) => !k.startsWith('_'));
                    if (argEntries.length > 0) {
                        const argContext = argEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
                        content = `${content}\n\nArguments: ${argContext}`;
                    }
                }
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
