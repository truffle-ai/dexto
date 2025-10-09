import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import { expandPlaceholders } from '../utils.js';
import { assertValidPromptName } from '../name-validation.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logger/index.js';
import { PromptError } from '../errors.js';
import { readFile, readdir } from 'fs/promises';
import { join, extname, resolve } from 'path';
import type { ResourceManager } from '../../resources/manager.js';

interface InternalPromptProviderOptions {
    promptsDir?: string;
    resourceManager: ResourceManager;
}

interface ParsedPrompt {
    info: PromptInfo;
    content: string;
}

// TODO: (355) Might not actually need InternalPromptProvider, seems equivalent to starter-prompt-provider with a hardcoded directory. Can keep for now but basically we can add file based prompt providers instead (refer to relative file colocated near the agent)
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413151059
export class InternalPromptProvider implements PromptProvider {
    private readonly promptsDir: string;
    private readonly resourceManager: ResourceManager;
    private promptsCache: PromptInfo[] = [];
    private cacheValid = false;
    private promptResources: Map<string, string> = new Map();
    private inlineContent: Map<string, string> = new Map();

    constructor(options: InternalPromptProviderOptions) {
        this.promptsDir = resolve(options.promptsDir ?? 'prompts');
        this.resourceManager = options.resourceManager;
    }

    getSource(): string {
        return 'internal';
    }

    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        this.promptResources.clear();
        this.inlineContent.clear();
        logger.debug('InternalPromptProvider cache invalidated');
    }

    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const prompt = this.promptsCache.find((p) => p.name === name);
        if (!prompt) {
            throw PromptError.notFound(name);
        }

        const resourceUri = this.promptResources.get(name);
        let text = this.inlineContent.get(name) ?? '';

        if (resourceUri) {
            try {
                const result = await this.resourceManager.read(resourceUri);
                const first = result.contents[0];
                if (first?.text && typeof first.text === 'string') {
                    text = first.text;
                } else if (first?.blob && typeof first.blob === 'string') {
                    text = Buffer.from(first.blob, 'base64').toString('utf-8');
                } else {
                    logger.warn(`Prompt ${name} resource ${resourceUri} did not contain text`);
                }
            } catch (error) {
                logger.warn(
                    `Failed to load prompt resource ${resourceUri}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (!text) {
            throw PromptError.missingText();
        }

        const resolved = this.applyArguments(text, args);
        const resourceContent = {
            type: 'resource' as const,
            resource: {
                uri: resourceUri ?? `prompt:${name}`,
                name,
                title: prompt.title ?? name,
                mimeType: 'text/markdown',
                text: resolved,
            },
        };

        return {
            description: prompt.description,
            messages: [
                {
                    role: 'user',
                    content: resourceContent,
                },
            ],
        };
    }

    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        return {
            prompts: this.promptsCache,
        };
    }

    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
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

    private async buildPromptsCache(): Promise<void> {
        const cache: PromptInfo[] = [];
        const resourceMap: Map<string, string> = new Map();
        const inlineMap: Map<string, string> = new Map();

        try {
            // Prompts are treated as agent configuration, so this provider loads the markdown
            // files directly before handing stored content off to ResourceManager/BlobService.
            const files = await readdir(this.promptsDir);
            const markdownFiles = files.filter((file) => extname(file).toLowerCase() === '.md');

            for (const file of markdownFiles) {
                try {
                    const parsed = await this.parsePromptFile(file);
                    const storage = await this.storePromptContent(parsed.content, file);
                    if (storage.resourceUri) {
                        resourceMap.set(parsed.info.name, storage.resourceUri);
                    }
                    if (storage.inlineContent) {
                        inlineMap.set(parsed.info.name, storage.inlineContent);
                    }

                    if (storage.resourceUri || storage.inlineContent) {
                        const metadata = {
                            ...(parsed.info.metadata ?? {}),
                            ...(storage.resourceUri && { resourceUri: storage.resourceUri }),
                        };
                        if (Object.keys(metadata).length > 0) {
                            parsed.info = { ...parsed.info, metadata };
                        } else {
                            parsed.info = { ...parsed.info };
                            delete parsed.info.metadata;
                        }
                    }

                    cache.push(parsed.info);
                } catch (error) {
                    logger.warn(
                        `Failed to process prompt file '${file}': ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            logger.debug(`📝 Cached ${cache.length} internal prompts from ${this.promptsDir}`);
        } catch (error) {
            logger.debug(
                `Prompts directory '${this.promptsDir}' not found or not accessible: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        this.promptsCache = cache;
        this.promptResources = resourceMap;
        this.inlineContent = inlineMap;
        this.cacheValid = true;
    }

    private async parsePromptFile(fileName: string): Promise<ParsedPrompt> {
        const promptName = fileName.replace(/\.md$/, '');
        const filePath = join(this.promptsDir, fileName);
        const content = await readFile(filePath, 'utf-8');

        const lines = content.trim().split('\n');
        let description = `Internal prompt: ${promptName}`;
        let title = promptName;
        let category: string | undefined;
        let id: string | undefined;
        let nameOverride: string | undefined;
        let contentBody: string | undefined;

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
                const frontmatterLines = lines.slice(1, frontmatterEnd);
                contentBody = lines.slice(frontmatterEnd + 1).join('\n');

                for (const line of frontmatterLines) {
                    if (line.includes('description:')) {
                        const descMatch = line.match(/description:\s*['"]?([^'"]+)['"]?/);
                        if (descMatch && descMatch[1]) {
                            description = descMatch[1];
                        }
                    } else if (line.includes('id:')) {
                        const idMatch = line.match(/id:\s*['"]?([^'"]+)['"]?/);
                        if (idMatch && idMatch[1]) {
                            id = idMatch[1];
                        }
                    } else if (line.includes('name:')) {
                        const nameMatch = line.match(/name:\s*['"]?([^'"]+)['"]?/);
                        if (nameMatch && nameMatch[1]) {
                            nameOverride = nameMatch[1];
                        }
                    } else if (line.includes('category:')) {
                        const categoryMatch = line.match(/category:\s*['"]?([^'"]+)['"]?/);
                        if (categoryMatch && categoryMatch[1]) {
                            category = categoryMatch[1];
                        }
                    }
                }
            }
        }

        if (!contentBody) {
            contentBody = content;
        }

        const bodyLines = contentBody.trim().split('\n');
        for (const line of bodyLines) {
            if (line.trim().startsWith('#')) {
                title = line.trim().replace(/^#+\s*/, '');
                break;
            }
        }

        const finalName = (nameOverride ?? promptName).trim();
        assertValidPromptName(finalName, {
            hint: "Use kebab-case in the 'name:' field or file name.",
        });

        const promptInfo: PromptInfo = {
            name: finalName,
            title,
            description,
            source: 'internal',
            metadata: {
                originalName: promptName,
                fileName,
                filePath,
                ...(id && { id }),
                ...(category && { category }),
            },
        };

        return { info: promptInfo, content: contentBody };
    }

    private async storePromptContent(
        content: string,
        fileName: string
    ): Promise<{ resourceUri?: string; inlineContent?: string }> {
        const blobService = this.resourceManager.getBlobStore();
        if (!blobService) {
            logger.warn('BlobService not available; storing prompt content in memory');
            return { inlineContent: content };
        }

        const blobInput = Buffer.from(content, 'utf-8');

        const blob = await blobService.store(blobInput, {
            mimeType: 'text/markdown',
            originalName: fileName,
            source: 'system',
        });

        return { resourceUri: blob.uri };
    }

    private applyArguments(content: string, args?: Record<string, unknown>): string {
        // First expand positional placeholders ($ARGUMENTS, $1..$9, $$)
        const expanded = expandPlaceholders(content, args).trim();

        if (!args || typeof args !== 'object' || Object.keys(args).length === 0) {
            return expanded;
        }

        if ((args as any)._context) {
            const contextString = String((args as any)._context);
            return `Context: ${contextString}\n\n${expanded}`;
        }

        const argContext = Object.entries(args)
            .filter(([key]) => !key.startsWith('_'))
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');

        if (!argContext) {
            return expanded;
        }

        return `Arguments: ${argContext}\n\n${expanded}`;
    }
}
