import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logger/index.js';
import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';

/**
 * Internal Prompt Provider - Provides prompts from markdown files in a prompts directory
 *
 * This provider reads markdown files from a configured directory and makes them available
 * as prompts. The filename (without extension) becomes the prompt identifier.
 * It implements the MCP specification for prompt discovery and retrieval.
 */
export class InternalPromptProvider implements PromptProvider {
    private promptsDir: string;
    private promptsCache: PromptInfo[] = [];
    private cacheValid: boolean = false;

    constructor(promptsDir: string = 'prompts') {
        this.promptsDir = promptsDir;
    }

    /**
     * Get the source identifier for this provider
     */
    getSource(): string {
        return 'internal';
    }

    /**
     * Invalidate the prompts cache
     */
    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        logger.debug('InternalPromptProvider cache invalidated');
    }

    /**
     * Build the prompts cache from markdown files
     */
    private async buildPromptsCache(): Promise<void> {
        const allPrompts: PromptInfo[] = [];

        try {
            // Check if prompts directory exists
            try {
                const files = await readdir(this.promptsDir);

                // Filter for markdown files
                const markdownFiles = files.filter((file) => extname(file).toLowerCase() === '.md');

                for (const file of markdownFiles) {
                    try {
                        const promptName = file.replace(/\.md$/, '');
                        const filePath = join(this.promptsDir, file);

                        // Read the markdown content
                        const content = await readFile(filePath, 'utf-8');

                        // Extract description from frontmatter and first line
                        const lines = content.trim().split('\n');
                        let description = `Internal prompt: ${promptName}`;
                        let title = promptName;

                        // Check for frontmatter
                        if (lines[0]?.trim() === '---') {
                            let inFrontmatter = false;
                            let frontmatterEnd = 0;

                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i]?.trim() === '---') {
                                    if (!inFrontmatter) {
                                        inFrontmatter = true;
                                    } else {
                                        frontmatterEnd = i;
                                        break;
                                    }
                                }
                            }

                            if (frontmatterEnd > 0) {
                                // Parse frontmatter
                                const frontmatterLines = lines.slice(1, frontmatterEnd);
                                for (const line of frontmatterLines) {
                                    if (line.includes('description:')) {
                                        const descMatch = line.match(
                                            /description:\s*["']?([^"']+)["']?/
                                        );
                                        if (descMatch) {
                                            description = descMatch[1];
                                        }
                                    }
                                }
                            }
                        }

                        // Extract title from first heading after frontmatter
                        for (const line of lines) {
                            if (line.trim().startsWith('#')) {
                                title = line.trim().replace(/^#+\s*/, '');
                                break;
                            }
                        }

                        const promptInfo: PromptInfo = {
                            name: promptName,
                            title,
                            description,
                            source: 'internal',
                            metadata: {
                                originalName: promptName,
                                filePath,
                                content,
                            },
                        };

                        allPrompts.push(promptInfo);
                    } catch (error) {
                        logger.warn(
                            `Failed to process prompt file '${file}': ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                logger.debug(
                    `📝 Cached ${allPrompts.length} internal prompts from ${this.promptsDir}`
                );
            } catch (error) {
                // Directory doesn't exist or can't be read
                logger.debug(
                    `Prompts directory '${this.promptsDir}' not found or not accessible: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        } catch (error) {
            logger.error(
                `Failed to build internal prompts cache: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        this.promptsCache = allPrompts;
        this.cacheValid = true;
    }

    /**
     * Get a prompt by name
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        try {
            if (!this.cacheValid) {
                await this.buildPromptsCache();
            }

            const promptInfo = this.promptsCache.find((p) => p.name === name);
            if (!promptInfo || !promptInfo.metadata?.content) {
                throw new Error(`Internal prompt not found: ${name}`);
            }

            logger.debug(`📝 Reading internal prompt: ${name}`);

            // Get the content and apply any arguments
            let content = promptInfo.metadata.content as string;

            // If args are provided, add context for the LLM to understand
            if (args && typeof args === 'object') {
                // Handle special _context argument for natural language input
                if (args._context) {
                    const contextString = String(args._context);
                    // Add context at the beginning so the LLM knows what to work with
                    content = `Context: ${contextString}\n\n${content}`;
                } else if (Object.keys(args).length > 0) {
                    // Handle explicit key=value arguments by adding them as context
                    const argContext = Object.entries(args)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                    content = `Arguments: ${argContext}\n\n${content}`;
                }
            }

            // Return the prompt content
            return {
                description: promptInfo.description,
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: content.trim(),
                        },
                    },
                ],
            };
        } catch (error) {
            logger.debug(
                `Failed to get prompt '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
            throw error; // Re-throw as GetPromptResult doesn't allow null
        }
    }

    /**
     * List all available internal prompts
     */
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }
        return {
            prompts: this.promptsCache,
        };
    }

    /**
     * Check if a prompt exists
     */
    async hasPrompt(name: string): Promise<boolean> {
        const prompts = await this.listPrompts();
        return prompts.prompts.some((prompt: PromptInfo) => prompt.name === name);
    }

    /**
     * Get prompt definition (metadata only)
     */
    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        try {
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
        } catch (error) {
            logger.debug(
                `Failed to get prompt definition for '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }
}
