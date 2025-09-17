import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptListResult, PromptProvider, PromptInfo } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedAgentConfig } from '../agent/schemas.js';
import type { AgentEventBus } from '../events/index.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { InternalPromptProvider } from './providers/internal-prompt-provider.js';
import { StarterPromptProvider } from './providers/starter-prompt-provider.js';
import { PromptError } from './errors.js';
import { logger } from '../logger/index.js';
import type { ResourceManager } from '../resources/manager.js';

interface PromptCacheEntry {
    key: string;
    providerName: string;
    providerPromptName: string;
    originalName: string;
    info: PromptInfo;
}

export class PromptsManager {
    private providers: Map<string, PromptProvider> = new Map();
    private promptIndex: Map<string, PromptCacheEntry> | undefined;
    private aliasMap: Map<string, string> = new Map();
    private buildPromise: Promise<void> | null = null;

    constructor(
        mcpManager: MCPManager,
        resourceManager: ResourceManager,
        promptsDir?: string,
        agentConfig?: ValidatedAgentConfig,
        private readonly eventBus?: AgentEventBus
    ) {
        this.providers.set('mcp', new MCPPromptProvider(mcpManager));
        const internalOptions = promptsDir ? { promptsDir, resourceManager } : { resourceManager };
        this.providers.set('internal', new InternalPromptProvider(internalOptions));
        this.providers.set('starter', new StarterPromptProvider(agentConfig));

        logger.debug(
            `PromptsManager initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`
        );

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
        }
    }

    async initialize(): Promise<void> {
        await this.ensureCache();
        logger.debug('PromptsManager initialization complete');
    }

    async list(): Promise<PromptSet> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        const result: PromptSet = {};
        for (const [key, entry] of index.entries()) {
            result[key] = entry.info;
        }
        return result;
    }

    async has(name: string): Promise<boolean> {
        const entry = await this.findEntry(name);
        return entry !== undefined;
    }

    async hasPrompt(name: string): Promise<boolean> {
        return this.has(name);
    }

    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        const prompts = Object.values(await this.list());
        return { prompts };
    }

    async getPromptDefinition(name: string): Promise<import('./types.js').PromptDefinition | null> {
        const entry = await this.findEntry(name);
        if (!entry) return null;
        const { info } = entry;
        return {
            name: info.name,
            ...(info.title && { title: info.title }),
            ...(info.description && { description: info.description }),
            ...(info.arguments && { arguments: info.arguments }),
        };
    }

    async getPromptsBySource(source: 'mcp' | 'internal' | 'starter'): Promise<PromptInfo[]> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        return Array.from(index.values())
            .filter((entry) => entry.info.source === source)
            .map((entry) => entry.info);
    }

    async searchPrompts(query: string): Promise<PromptInfo[]> {
        const searchTerm = query.toLowerCase();
        const prompts = await this.list();
        return Object.values(prompts).filter((prompt) => {
            return (
                prompt.name.toLowerCase().includes(searchTerm) ||
                (prompt.description && prompt.description.toLowerCase().includes(searchTerm)) ||
                (prompt.title && prompt.title.toLowerCase().includes(searchTerm))
            );
        });
    }

    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const entry = await this.findEntry(name);
        if (!entry) {
            throw PromptError.notFound(name);
        }

        const provider = this.providers.get(entry.providerName);
        if (!provider) {
            throw PromptError.providerNotFound(entry.providerName);
        }

        return await provider.getPrompt(entry.providerPromptName, args);
    }

    async resolvePromptKey(nameOrAlias: string): Promise<string | null> {
        await this.ensureCache();
        if (!this.promptIndex) return null;

        if (this.promptIndex.has(nameOrAlias)) {
            return nameOrAlias;
        }

        const normalized = nameOrAlias.startsWith('/') ? nameOrAlias.slice(1) : nameOrAlias;
        const aliasMatch = this.aliasMap.get(nameOrAlias) ?? this.aliasMap.get(normalized);
        return aliasMatch ?? null;
    }

    async refresh(): Promise<void> {
        this.promptIndex = undefined;
        this.aliasMap.clear();
        for (const provider of this.providers.values()) {
            provider.invalidateCache();
        }
        await this.ensureCache();
        logger.info('PromptsManager refreshed');
    }

    getProvider(source: string): PromptProvider | undefined {
        return this.providers.get(source);
    }

    getProviderSources(): string[] {
        return Array.from(this.providers.keys());
    }

    private sanitizePromptInfo(prompt: PromptInfo, providerName: string): PromptInfo {
        const metadata = { ...(prompt.metadata ?? {}) } as Record<string, unknown>;
        delete metadata.content;
        delete metadata.prompt;
        delete metadata.filePath;
        delete metadata.messages;

        if (!metadata.originalName) {
            metadata.originalName = prompt.name;
        }
        metadata.provider = providerName;

        const sanitized: PromptInfo = { ...prompt };
        if (Object.keys(metadata).length > 0) {
            sanitized.metadata = metadata;
        } else {
            delete sanitized.metadata;
        }
        return sanitized;
    }

    private async ensureCache(): Promise<void> {
        if (this.promptIndex) {
            return;
        }
        if (this.buildPromise) {
            await this.buildPromise;
            return;
        }
        this.buildPromise = this.buildCache();
        try {
            await this.buildPromise;
        } finally {
            this.buildPromise = null;
        }
    }

    private async buildCache(): Promise<void> {
        const index = new Map<string, PromptCacheEntry>();
        const aliases = new Map<string, string>();

        for (const [providerName, provider] of this.providers) {
            try {
                const { prompts } = await provider.listPrompts();
                for (const prompt of prompts) {
                    this.insertPrompt(index, aliases, providerName, prompt);
                }
            } catch (error) {
                logger.error(
                    `Failed to get prompts from ${providerName} provider: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.promptIndex = index;
        this.aliasMap = aliases;

        if (index.size > 0) {
            const sample = Array.from(index.keys()).slice(0, 5);
            logger.debug(
                `📋 Prompt discovery: ${index.size} prompts. Sample: ${sample.join(', ')}`
            );
        }
    }

    private insertPrompt(
        index: Map<string, PromptCacheEntry>,
        aliases: Map<string, string>,
        providerName: string,
        prompt: PromptInfo
    ): void {
        const providerPromptName = prompt.name;
        const prepared = this.sanitizePromptInfo(prompt, providerName);
        let key = providerPromptName;
        const originalName = providerPromptName;

        if (index.has(key)) {
            const existing = index.get(key)!;
            index.delete(key);

            const existingKey = `${existing.providerName}:${existing.originalName}`;
            const updatedExisting: PromptCacheEntry = {
                ...existing,
                key: existingKey,
                info:
                    existing.info.name === existingKey
                        ? existing.info
                        : { ...existing.info, name: existingKey },
            };
            index.set(existingKey, updatedExisting);
            aliases.set(existing.originalName, existingKey);
            key = `${providerName}:${originalName}`;
        }

        const entryInfo =
            prepared.name === key ? prepared : ({ ...prepared, name: key } as PromptInfo);
        const entry: PromptCacheEntry = {
            key,
            providerName,
            providerPromptName,
            originalName,
            info: entryInfo,
        };

        index.set(key, entry);
        aliases.set(originalName, key);

        const metadata = entryInfo.metadata as Record<string, unknown> | undefined;
        if (metadata) {
            const aliasCandidates = new Set<string>();
            if (typeof metadata.originalName === 'string') {
                aliasCandidates.add(metadata.originalName);
            }
            if (typeof metadata.command === 'string') {
                const command = metadata.command as string;
                aliasCandidates.add(command);
                if (command.startsWith('/')) {
                    aliasCandidates.add(command.slice(1));
                }
            }

            for (const candidate of aliasCandidates) {
                if (candidate && !aliases.has(candidate)) {
                    aliases.set(candidate, key);
                }
            }
        }
    }

    private async findEntry(name: string): Promise<PromptCacheEntry | undefined> {
        await this.ensureCache();
        if (!this.promptIndex) return undefined;

        if (this.promptIndex.has(name)) {
            return this.promptIndex.get(name);
        }

        const normalized = name.startsWith('/') ? name.slice(1) : name;
        const alias = this.aliasMap.get(name) ?? this.aliasMap.get(normalized);
        if (alias && this.promptIndex.has(alias)) {
            return this.promptIndex.get(alias);
        }

        return undefined;
    }
}
