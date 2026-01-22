import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptProvider, PromptInfo, ResolvedPromptResult } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedAgentConfig } from '../agent/schemas.js';
import type { PromptsConfig } from './schemas.js';
import type { AgentEventBus } from '../events/index.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { ConfigPromptProvider } from './providers/config-prompt-provider.js';
import {
    CustomPromptProvider,
    type CreateCustomPromptInput,
} from './providers/custom-prompt-provider.js';
import { PromptError } from './errors.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { ResourceManager } from '../resources/manager.js';
import type { Database } from '../storage/database/types.js';
import { normalizePromptArgs, flattenPromptResult } from './utils.js';

interface PromptCacheEntry {
    providerName: string;
    providerPromptName: string;
    originalName: string;
    info: PromptInfo;
}

export class PromptManager {
    private providers: Map<string, PromptProvider> = new Map();
    private configProvider: ConfigPromptProvider;
    private promptIndex: Map<string, PromptCacheEntry> | undefined;
    private aliasMap: Map<string, string> = new Map();
    private buildPromise: Promise<void> | null = null;
    private logger: IDextoLogger;

    constructor(
        mcpManager: MCPManager,
        resourceManager: ResourceManager,
        agentConfig: ValidatedAgentConfig,
        private readonly eventBus: AgentEventBus,
        private readonly database: Database,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.PROMPT);
        this.configProvider = new ConfigPromptProvider(agentConfig, this.logger);
        this.providers.set('mcp', new MCPPromptProvider(mcpManager, this.logger));
        this.providers.set('config', this.configProvider);
        this.providers.set(
            'custom',
            new CustomPromptProvider(this.database, resourceManager, this.logger)
        );

        this.logger.debug(
            `PromptManager initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`
        );

        const refresh = async (reason: string) => {
            this.logger.debug(`PromptManager refreshing due to: ${reason}`);
            await this.refresh();
        };

        this.eventBus.on('mcp:server-connected', async (p) => {
            if (p.success) {
                await refresh(`mcpServerConnected:${p.name}`);
            }
        });
        this.eventBus.on('mcp:server-removed', async (p) => {
            await refresh(`mcpServerRemoved:${p.serverName}`);
        });
        this.eventBus.on('mcp:server-updated', async (p) => {
            await refresh(`mcpServerUpdated:${p.serverName}`);
        });

        // Listen for MCP notifications for surgical updates
        this.eventBus.on('mcp:prompts-list-changed', async (p) => {
            await this.updatePromptsForServer(p.serverName, p.prompts);
            this.logger.debug(
                `🔄 Surgically updated prompts for server '${p.serverName}': [${p.prompts.join(', ')}]`
            );
        });
    }

    async initialize(): Promise<void> {
        await this.ensureCache();
        this.logger.debug('PromptManager initialization complete');
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
            // Claude Code compatibility fields
            ...(info.disableModelInvocation !== undefined && {
                disableModelInvocation: info.disableModelInvocation,
            }),
            ...(info.userInvocable !== undefined && { userInvocable: info.userInvocable }),
            ...(info.allowedTools !== undefined && { allowedTools: info.allowedTools }),
            ...(info.model !== undefined && { model: info.model }),
        };
    }

    /**
     * List prompts that should appear in the CLI slash command menu.
     * Filters out prompts with `userInvocable: false`.
     * These prompts are intended for user invocation via `/` commands.
     */
    async listUserInvocablePrompts(): Promise<PromptSet> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        const result: PromptSet = {};
        for (const [key, entry] of index.entries()) {
            // Include prompt if userInvocable is not explicitly set to false
            if (entry.info.userInvocable !== false) {
                result[key] = entry.info;
            }
        }
        return result;
    }

    /**
     * List prompts that can be auto-invoked by the LLM.
     * Filters out prompts with `disableModelInvocation: true`.
     * These prompts should appear in the system prompt as available skills.
     */
    async listAutoInvocablePrompts(): Promise<PromptSet> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        const result: PromptSet = {};
        for (const [key, entry] of index.entries()) {
            // Include prompt if disableModelInvocation is not explicitly set to true
            if (entry.info.disableModelInvocation !== true) {
                result[key] = entry.info;
            }
        }
        return result;
    }

    /**
     * Retrieve a prompt from the appropriate provider.
     *
     * Responsibilities:
     * - Resolve the correct provider by prompt name (post-cache lookup)
     * - Map positional arguments (`args._positional: string[]`) to named arguments based
     *   on the prompt's declared `arguments` schema (order-based mapping)
     * - Forward `_context` and any named args to the provider
     *
     * Mapping rules:
     * - If `PromptInfo.arguments` is defined (e.g., MCP or file prompts with `argument-hint:`),
     *   then each position in `_positional` fills the corresponding named arg if not already set.
     * - Named arguments already present in `args` are not overwritten by positional tokens.
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const entry = await this.findEntry(name);
        if (!entry) {
            throw PromptError.notFound(name);
        }

        const provider = this.providers.get(entry.providerName);
        if (!provider) {
            throw PromptError.providerNotFound(entry.providerName);
        }

        // Map positional arguments to named arguments based on prompt's argument schema
        // This bridges the gap between user input (positional, like $1 $2)
        // and MCP protocol expectations (named arguments like { report_type: "metrics" })
        let finalArgs = args;
        if (args?._positional && Array.isArray(args._positional) && args._positional.length > 0) {
            const promptArgs = entry.info.arguments;
            if (promptArgs && promptArgs.length > 0) {
                finalArgs = { ...args };
                const positionalArgs = args._positional as unknown[];
                // Map positional args to named args based on the prompt's argument order
                promptArgs.forEach((argDef, index) => {
                    if (index < positionalArgs.length && !finalArgs![argDef.name]) {
                        // Only set if not already provided as a named argument
                        const value = positionalArgs[index];
                        finalArgs![argDef.name] = typeof value === 'string' ? value : String(value);
                    }
                });
            }
        }

        // Provider-specific argument filtering:
        // - MCP: pass only declared arguments (strip internal keys and unknowns)
        // - Others: pass through (file/custom use _positional/_context semantics)
        let providerArgs: Record<string, unknown> | undefined = finalArgs;
        if (entry.providerName === 'mcp') {
            const declared = new Set((entry.info.arguments ?? []).map((a) => a.name));
            const filtered: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(finalArgs ?? {})) {
                if (key.startsWith('_')) continue; // strip internal keys
                if (declared.size === 0 || declared.has(key)) {
                    filtered[key] = value;
                }
            }
            providerArgs = filtered;
        }

        return await provider.getPrompt(entry.providerPromptName, providerArgs);
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

    /**
     * Resolves a prompt to its text content with all arguments applied.
     * This is a high-level method that handles:
     * - Prompt key resolution (resolving aliases)
     * - Argument normalization (including special `_context` field)
     * - Passing `_context` through to providers so they can decide whether to append it
     *   (e.g., file prompts without placeholders will append `Context: ...`)
     * - Prompt execution and flattening
     * - Returning per-prompt overrides (allowedTools, model) for the invoker to apply
     *
     * @param name The prompt name or alias
     * @param options Optional configuration for prompt resolution
     * @returns Promise resolving to the resolved text, resource URIs, and optional overrides
     */
    async resolvePrompt(
        name: string,
        options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {}
    ): Promise<ResolvedPromptResult> {
        // Build args from options
        const args: Record<string, unknown> = { ...options.args };
        // Preserve `_context` on args for providers that need to decide whether to append it
        if (options.context?.trim()) args._context = options.context.trim();

        // Resolve provided name to a valid prompt key using promptManager
        const resolvedName = (await this.resolvePromptKey(name)) ?? name;

        // Get prompt definition to extract per-prompt overrides
        const promptDef = await this.getPromptDefinition(resolvedName);

        // Normalize args (converts to strings, extracts context)
        const normalized = normalizePromptArgs(args);

        // Providers need `_context` to decide whether to append it (e.g., file prompts without placeholders)
        const providerArgs = normalized.context
            ? { ...normalized.args, _context: normalized.context }
            : normalized.args;

        // Get and flatten the prompt result
        // Note: PromptManager handles positional-to-named argument mapping internally
        const promptResult = await this.getPrompt(resolvedName, providerArgs);
        const flattened = flattenPromptResult(promptResult);

        // Context handling is done by the prompt providers themselves
        // (they check for placeholders and decide whether to append context)

        // Validate result
        if (!flattened.text && flattened.resourceUris.length === 0) {
            throw PromptError.emptyResolvedContent(resolvedName);
        }

        return {
            text: flattened.text,
            resources: flattened.resourceUris,
            // Include per-prompt overrides from prompt definition
            ...(promptDef?.allowedTools && { allowedTools: promptDef.allowedTools }),
            ...(promptDef?.model && { model: promptDef.model }),
            ...(promptDef?.context && { context: promptDef.context }),
        };
    }

    async refresh(): Promise<void> {
        this.promptIndex = undefined;
        this.aliasMap.clear();
        for (const provider of this.providers.values()) {
            provider.invalidateCache();
        }
        await this.ensureCache();
        this.logger.info('PromptManager refreshed');
    }

    /**
     * Updates the config prompts at runtime.
     * Call this after modifying the agent config file to reflect new prompts.
     */
    updateConfigPrompts(prompts: PromptsConfig): void {
        this.configProvider.updatePrompts(prompts);
        this.promptIndex = undefined;
        this.aliasMap.clear();
        this.logger.debug('Config prompts updated');
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
                this.logger.debug(
                    `Failed to get updated prompts for server '${serverName}': ${error}`
                );
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
        // Keep filePath - needed for prompt deletion
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
                this.logger.error(
                    `Failed to get prompts from ${providerName} provider: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.promptIndex = index;
        this.aliasMap = aliases;

        if (index.size > 0) {
            const sample = Array.from(index.keys()).slice(0, 5);
            this.logger.debug(
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
