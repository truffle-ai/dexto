import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptProvider, PromptInfo } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedAgentConfig } from '../agent/schemas.js';
import type { AgentEventBus } from '../events/index.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { InternalPromptProvider } from './providers/internal-prompt-provider.js';
import { StarterPromptProvider } from './providers/starter-prompt-provider.js';
import {
    CustomPromptProvider,
    type CreateCustomPromptInput,
} from './providers/custom-prompt-provider.js';
import { PromptError } from './errors.js';
import { logger } from '../logger/index.js';
import type { ResourceManager } from '../resources/manager.js';
import type { DatabaseBackend } from '../storage/backend/database-backend.js';

interface PromptCacheEntry {
    // TODO: (355) Likely duplicate key. We also might be doing double caching in both prompt manager and the providers which is unnecessary
    // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413113270
    key: string;
    providerName: string;
    providerPromptName: string;
    originalName: string;
    info: PromptInfo;
}

// TODO: (355) Nit: rename to PromptManager for consistency with other services + add docstring
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413083171
export class PromptsManager {
    private providers: Map<string, PromptProvider> = new Map();
    private promptIndex: Map<string, PromptCacheEntry> | undefined;
    private aliasMap: Map<string, string> = new Map();
    private buildPromise: Promise<void> | null = null;

    // TODO: (355) Unnecessary optional args
    // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413106494
    constructor(
        mcpManager: MCPManager,
        resourceManager: ResourceManager,
        promptsDir?: string,
        agentConfig?: ValidatedAgentConfig,
        private readonly eventBus?: AgentEventBus,
        private readonly database?: DatabaseBackend
    ) {
        this.providers.set('mcp', new MCPPromptProvider(mcpManager));
        const internalOptions = promptsDir ? { promptsDir, resourceManager } : { resourceManager };
        this.providers.set('internal', new InternalPromptProvider(internalOptions));
        this.providers.set('starter', new StarterPromptProvider(agentConfig));
        if (this.database) {
            this.providers.set('custom', new CustomPromptProvider(this.database, resourceManager));
        }

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

            // Listen for MCP notifications for surgical updates
            this.eventBus.on('dexto:mcpPromptsListChanged', async (p) => {
                await this.updatePromptsForServer(p.serverName, p.prompts);
                logger.debug(
                    `🔄 Surgically updated prompts for server '${p.serverName}': [${p.prompts.join(', ')}]`
                );
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

    async createCustomPrompt(input: CreateCustomPromptInput): Promise<PromptInfo> {
        const provider = this.providers.get('custom');
        if (!provider || !(provider instanceof CustomPromptProvider)) {
            throw PromptError.providerNotFound('custom');
        }
        const prompt = await provider.createPrompt(input);
        await this.refresh();
        return prompt;
    }

    async deleteCustomPrompt(name: string): Promise<void> {
        const provider = this.providers.get('custom');
        if (!provider || !(provider instanceof CustomPromptProvider)) {
            throw PromptError.providerNotFound('custom');
        }
        await provider.deletePrompt(name);
        await this.refresh();
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

    /**
     * Surgically update prompts for a specific MCP server instead of full cache rebuild
     */
    private async updatePromptsForServer(serverName: string, _newPrompts: string[]): Promise<void> {
        await this.ensureCache();
        if (!this.promptIndex) return;

        // Remove existing prompts from this server
        this.removePromptsForServer(serverName);

        // Add new prompts from this server
        const mcpProvider = this.providers.get('mcp');
        if (mcpProvider) {
            try {
                const { prompts } = await mcpProvider.listPrompts();
                const serverPrompts = prompts.filter(
                    (p) =>
                        p.metadata &&
                        typeof p.metadata === 'object' &&
                        'serverName' in p.metadata &&
                        p.metadata.serverName === serverName
                );

                for (const prompt of serverPrompts) {
                    this.insertPrompt(this.promptIndex, this.aliasMap, 'mcp', prompt);
                }
            } catch (error) {
                logger.debug(`Failed to get updated prompts for server '${serverName}': ${error}`);
            }
        }
    }

    /**
     * Remove all prompts from a specific server
     */
    private removePromptsForServer(serverName: string): void {
        if (!this.promptIndex) return;

        const keysToRemove: string[] = [];
        for (const [key, entry] of this.promptIndex.entries()) {
            if (
                entry.providerName === 'mcp' &&
                entry.info.metadata &&
                typeof entry.info.metadata === 'object' &&
                'serverName' in entry.info.metadata &&
                entry.info.metadata.serverName === serverName
            ) {
                keysToRemove.push(key);
            }
        }

        // Remove from index and aliases
        for (const key of keysToRemove) {
            const entry = this.promptIndex.get(key);
            if (entry) {
                this.promptIndex.delete(key);
                // Remove aliases that point to this key
                for (const [aliasKey, aliasValue] of Array.from(this.aliasMap.entries())) {
                    if (aliasValue === key) {
                        this.aliasMap.delete(aliasKey);
                    }
                }
            }
        }
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
            // TODO: (355) Agent: check if double caching in prompt manager and providers can be simplified, add a TODO for this at least
            // https://github.com/truffle-ai/dexto/pull/355#discussion_r2413167239
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
