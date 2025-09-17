import type {
    PromptProvider,
    PromptInfo,
    PromptDefinition,
    PromptListResult,
    PromptArgument,
} from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { DatabaseBackend } from '../../storage/backend/database-backend.js';
import type { ResourceManager } from '../../resources/manager.js';
import { logger } from '../../logger/index.js';
import { PromptError } from '../errors.js';

const CUSTOM_PROMPT_KEY_PREFIX = 'prompt:custom:';

interface StoredCustomPrompt {
    id: string;
    name: string;
    title?: string;
    description?: string;
    content: string;
    arguments?: PromptArgument[];
    resourceUri?: string;
    resourceMetadata?: {
        originalName?: string;
        mimeType?: string;
    };
    createdAt: number;
    updatedAt: number;
}

export interface CreateCustomPromptInput {
    name: string;
    title?: string;
    description?: string;
    content: string;
    arguments?: PromptArgument[];
    resource?: {
        base64: string;
        mimeType: string;
        filename?: string;
    };
}

export class CustomPromptProvider implements PromptProvider {
    private cacheValid = false;
    private promptsCache: PromptInfo[] = [];
    private promptRecords: Map<string, StoredCustomPrompt> = new Map();

    constructor(
        private database: DatabaseBackend,
        private resourceManager?: ResourceManager
    ) {}

    getSource(): string {
        return 'custom';
    }

    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        this.promptRecords.clear();
    }

    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildCache();
        }

        return { prompts: this.promptsCache };
    }

    async hasPrompt(name: string): Promise<boolean> {
        if (!this.cacheValid) {
            await this.buildCache();
        }
        return this.promptRecords.has(name);
    }

    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            await this.buildCache();
        }
        const record = this.promptRecords.get(name);
        if (!record) {
            throw PromptError.notFound(name);
        }

        const messages: GetPromptResult['messages'] = [];
        const textContent = this.applyArguments(record.content, args);
        messages.push({
            role: 'user',
            content: {
                type: 'text',
                text: textContent,
            },
        });

        if (record.resourceUri) {
            messages.push({
                role: 'user',
                content: {
                    type: 'resource',
                    resource: {
                        uri: record.resourceUri,
                        name: record.resourceMetadata?.originalName || record.name,
                        title: record.title || record.name,
                        mimeType: record.resourceMetadata?.mimeType || 'application/octet-stream',
                        text: '',
                    },
                },
            });
        }

        return {
            description: record.description,
            messages,
        };
    }

    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        if (!this.cacheValid) {
            await this.buildCache();
        }
        const record = this.promptRecords.get(name);
        if (!record) return null;
        return {
            name: record.name,
            ...(record.title && { title: record.title }),
            ...(record.description && { description: record.description }),
            ...(record.arguments && { arguments: record.arguments }),
        };
    }

    async createPrompt(input: CreateCustomPromptInput): Promise<PromptInfo> {
        const id = this.slugify(input.name);
        if (!id) {
            throw PromptError.nameRequired();
        }

        if (!input.content || input.content.trim().length === 0) {
            throw PromptError.missingText();
        }

        if (!this.cacheValid) {
            await this.buildCache();
        }

        if (this.promptRecords.has(id)) {
            throw PromptError.alreadyExists(id);
        }

        let resourceUri: string | undefined;
        let resourceMetadata: StoredCustomPrompt['resourceMetadata'] | undefined;

        if (input.resource && this.resourceManager) {
            const blobService = this.resourceManager.getBlobService();
            if (blobService) {
                try {
                    const { base64, mimeType, filename } = input.resource;
                    const blobRef = await blobService.store(base64, {
                        mimeType,
                        originalName: filename,
                        source: 'system',
                    });
                    resourceUri = blobRef.uri;
                    const meta: { originalName?: string; mimeType?: string } = {};
                    const originalName = blobRef.metadata.originalName ?? filename;
                    if (originalName) {
                        meta.originalName = originalName;
                    }
                    if (blobRef.metadata.mimeType) {
                        meta.mimeType = blobRef.metadata.mimeType;
                    }
                    resourceMetadata = Object.keys(meta).length > 0 ? meta : undefined;
                } catch (error) {
                    logger.warn(`Failed to store custom prompt resource: ${String(error)}`);
                }
            }
        }

        const now = Date.now();
        const record: StoredCustomPrompt = {
            id,
            name: id,
            content: input.content,
            createdAt: now,
            updatedAt: now,
            ...(input.title ? { title: input.title } : {}),
            ...(input.description ? { description: input.description } : {}),
            ...(input.arguments && input.arguments.length > 0
                ? { arguments: input.arguments }
                : {}),
            ...(resourceUri ? { resourceUri } : {}),
            ...(resourceMetadata ? { resourceMetadata } : {}),
        };

        await this.database.set(this.toKey(id), record);
        this.invalidateCache();
        await this.buildCache();

        const prompt = this.promptsCache.find((p) => p.name === id);
        if (!prompt) {
            throw PromptError.notFound(id);
        }
        return prompt;
    }

    async deletePrompt(name: string): Promise<void> {
        if (!this.cacheValid) {
            await this.buildCache();
        }
        const record = this.promptRecords.get(name);
        if (!record) {
            throw PromptError.notFound(name);
        }

        await this.database.delete(this.toKey(name));
        if (record.resourceUri && this.resourceManager?.getBlobService()) {
            try {
                await this.resourceManager.getBlobService()!.delete(record.resourceUri);
            } catch (error) {
                logger.warn(`Failed to delete blob for custom prompt ${name}: ${String(error)}`);
            }
        }
        this.invalidateCache();
    }

    private async buildCache(): Promise<void> {
        try {
            const keys = await this.database.list(CUSTOM_PROMPT_KEY_PREFIX);
            const prompts: PromptInfo[] = [];
            this.promptRecords.clear();
            for (const key of keys) {
                try {
                    const record = await this.database.get<StoredCustomPrompt>(key);
                    if (!record) continue;
                    this.promptRecords.set(record.name, record);
                    const metadata: Record<string, unknown> = {
                        originalName:
                            record.resourceMetadata?.originalName &&
                            record.resourceMetadata.originalName.trim().length > 0
                                ? record.resourceMetadata.originalName
                                : record.name,
                    };

                    if (record.resourceUri) {
                        metadata.resourceUri = record.resourceUri;
                    }

                    if (record.resourceMetadata?.mimeType) {
                        metadata.mimeType = record.resourceMetadata.mimeType;
                    }

                    metadata.createdAt = record.createdAt;
                    metadata.updatedAt = record.updatedAt;

                    prompts.push({
                        name: record.name,
                        title: record.title,
                        description: record.description,
                        source: 'custom',
                        ...(record.arguments && { arguments: record.arguments }),
                        metadata,
                    });
                } catch (error) {
                    logger.warn(`Failed to load custom prompt from ${key}: ${String(error)}`);
                }
            }
            this.promptsCache = prompts;
            this.cacheValid = true;
        } catch (error) {
            logger.error(`Failed to build custom prompts cache: ${String(error)}`);
            this.promptsCache = [];
            this.cacheValid = false;
        }
    }

    private toKey(id: string): string {
        return `${CUSTOM_PROMPT_KEY_PREFIX}${id}`;
    }

    private slugify(name: string): string {
        const slug = name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-_]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return slug;
    }

    private applyArguments(content: string, args?: Record<string, unknown>): string {
        if (!args || Object.keys(args).length === 0) {
            return content;
        }
        let result = content;
        for (const [key, value] of Object.entries(args)) {
            const placeholder = `{{${key}}}`;
            result = result.replaceAll(placeholder, String(value));
        }
        return result;
    }
}
