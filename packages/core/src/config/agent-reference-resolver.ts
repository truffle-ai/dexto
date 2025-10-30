/**
 * Agent Reference Resolver
 *
 * Resolves agent references for spawn_agent tool to agent configurations.
 * Supports three types of references:
 * 1. Built-in agent names ('general-purpose', 'code-reviewer', 'test-runner')
 * 2. File paths (relative: './agent.yml', absolute: '/path/to/agent.yml')
 * 3. Inline configs (partial AgentConfig objects merged with defaults)
 */

import path from 'path';
import { promises as fs } from 'fs';
import { AgentConfig } from '@core/agent/schemas.js';
import { loadAgentConfig } from './loader.js';
import { ConfigError } from './errors.js';
import { logger } from '../logger/index.js';
import { findDextoSourceRoot } from '@core/utils/execution-context.js';
import { getDextoPath } from '@core/utils/path.js';

/**
 * Agent reference types for spawn_agent
 */
export type AgentReference = string | Partial<AgentConfig>;

/**
 * Known built-in agent names
 */
export const BUILT_IN_AGENTS = ['general-purpose', 'code-reviewer', 'test-runner'] as const;

export type BuiltInAgentName = (typeof BUILT_IN_AGENTS)[number];

/**
 * Check if a string is a known built-in agent name
 */
export function isBuiltInAgent(name: string): name is BuiltInAgentName {
    return BUILT_IN_AGENTS.includes(name as BuiltInAgentName);
}

/**
 * Resolution context for agent references
 */
export interface AgentResolutionContext {
    /** Working directory for relative path resolution */
    workingDir: string;
    /** Parent session ID (for logging/debugging) */
    parentSessionId?: string;
}

/**
 * Resolved agent configuration with metadata
 */
export interface ResolvedAgentConfig {
    /** The fully loaded and validated agent configuration */
    config: AgentConfig;
    /** Source of the config (for logging/debugging) */
    source: {
        type: 'built-in' | 'file' | 'inline';
        identifier: string; // Agent name, file path, or 'inline'
    };
}

/**
 * Config resolution cache
 * Key: cache identifier (built-in name or absolute file path)
 * Value: resolved config with timestamp
 */
interface CacheEntry {
    config: AgentConfig;
    timestamp: number;
    source: ResolvedAgentConfig['source'];
}

class AgentConfigCache {
    private cache = new Map<string, CacheEntry>();
    private readonly ttl: number = 5 * 60 * 1000; // 5 minutes

    /**
     * Get cached config if still valid
     */
    get(key: string): AgentConfig | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if cache is still valid
        const age = Date.now() - entry.timestamp;
        if (age > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        logger.debug(`Cache hit for agent config: ${key}`);
        return entry.config;
    }

    /**
     * Store config in cache
     */
    set(key: string, config: AgentConfig, source: ResolvedAgentConfig['source']): void {
        this.cache.set(key, {
            config,
            timestamp: Date.now(),
            source,
        });
        logger.debug(`Cached agent config: ${key}`);
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        logger.debug('Agent config cache cleared');
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
                key,
                age: Date.now() - entry.timestamp,
                source: entry.source,
            })),
        };
    }
}

// Singleton cache instance
const configCache = new AgentConfigCache();

/**
 * Main entry point: Resolve agent reference to full config
 */
export async function resolveAgentConfig(
    reference: AgentReference,
    context: AgentResolutionContext
): Promise<ResolvedAgentConfig> {
    logger.debug(`Resolving agent reference in context: ${context.workingDir}`);

    // Handle string references
    if (typeof reference === 'string') {
        return await resolveStringReference(reference, context);
    }

    // Handle inline config objects
    return await resolveInlineConfig(reference);
}

/**
 * Resolve string reference (built-in name or file path)
 */
async function resolveStringReference(
    reference: string,
    context: AgentResolutionContext
): Promise<ResolvedAgentConfig> {
    // Check if it's a built-in agent name
    if (isBuiltInAgent(reference)) {
        return await resolveBuiltInAgent(reference);
    }

    // Otherwise treat as file path
    return await resolveFilePath(reference, context);
}

/**
 * Resolve built-in agent by name
 */
async function resolveBuiltInAgent(name: BuiltInAgentName): Promise<ResolvedAgentConfig> {
    logger.debug(`Resolving built-in agent: ${name}`);

    // Check cache first
    const cacheKey = `built-in:${name}`;
    const cached = configCache.get(cacheKey);
    if (cached) {
        return {
            config: cached,
            source: { type: 'built-in', identifier: name },
        };
    }

    // Locate built-in agent file
    const builtInPath = await locateBuiltInAgent(name);

    // Load config from file
    try {
        const config = await loadAgentConfig(builtInPath);

        // Cache the result
        const source = { type: 'built-in' as const, identifier: name };
        configCache.set(cacheKey, config, source);

        logger.info(`Loaded built-in agent: ${name}`);
        return { config, source };
    } catch (error) {
        throw ConfigError.builtInAgentLoadFailed(
            name,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Locate built-in agent file path
 */
async function locateBuiltInAgent(name: BuiltInAgentName): Promise<string> {
    // Try to use getDextoPath utility
    try {
        const builtInPath = getDextoPath('agents', `built-in/${name}.yml`);
        await fs.access(builtInPath);
        return builtInPath;
    } catch {
        // Fallback: try to find from dexto source root
        const sourceRoot = findDextoSourceRoot();
        if (sourceRoot) {
            const fallbackPath = path.join(sourceRoot, 'agents', 'built-in', `${name}.yml`);
            try {
                await fs.access(fallbackPath);
                return fallbackPath;
            } catch {
                throw ConfigError.builtInAgentNotFound(name, fallbackPath);
            }
        }

        throw ConfigError.builtInAgentNotFound(name);
    }
}

/**
 * Resolve file path (relative or absolute)
 */
async function resolveFilePath(
    filePath: string,
    context: AgentResolutionContext
): Promise<ResolvedAgentConfig> {
    logger.debug(`Resolving agent file path: ${filePath}`);

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(context.workingDir, filePath);

    // Check if file exists
    try {
        await fs.access(absolutePath);
    } catch {
        throw ConfigError.fileNotFound(absolutePath);
    }

    // Check cache (file-based configs cached by absolute path + mtime)
    const cacheKey = `file:${absolutePath}`;
    const cached = configCache.get(cacheKey);
    if (cached) {
        return {
            config: cached,
            source: { type: 'file', identifier: filePath },
        };
    }

    // Load config from file
    try {
        const config = await loadAgentConfig(absolutePath);

        // Cache the result
        const source = { type: 'file' as const, identifier: filePath };
        configCache.set(cacheKey, config, source);

        logger.info(`Loaded agent config from file: ${filePath}`);
        return { config, source };
    } catch (error) {
        throw ConfigError.loadFailed(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Resolve inline config by merging with defaults
 */
async function resolveInlineConfig(partial: Partial<AgentConfig>): Promise<ResolvedAgentConfig> {
    logger.debug('Resolving inline agent config');

    try {
        // Load default built-in agent as base
        const defaultAgent = await resolveBuiltInAgent('general-purpose');
        const baseConfig = defaultAgent.config;

        // Merge inline config with defaults
        // Strategy: Deep merge for system prompts, override for tools and LLM
        const merged: AgentConfig = {
            ...baseConfig,
            ...partial,

            // Handle system prompt merging
            systemPrompt: partial.systemPrompt
                ? mergeSystemPrompts(baseConfig.systemPrompt, partial.systemPrompt)
                : baseConfig.systemPrompt,

            // Tools: override (don't merge arrays)
            internalTools: partial.internalTools || baseConfig.internalTools,

            // LLM: override completely if specified
            llm: partial.llm || baseConfig.llm,

            // Storage: merge
            storage: partial.storage
                ? { ...baseConfig.storage, ...partial.storage }
                : baseConfig.storage,

            // Tool confirmation: merge
            toolConfirmation: partial.toolConfirmation
                ? { ...baseConfig.toolConfirmation, ...partial.toolConfirmation }
                : baseConfig.toolConfirmation,
        };

        logger.info('Created inline agent config');
        return {
            config: merged,
            source: { type: 'inline', identifier: 'inline' },
        };
    } catch (error) {
        throw ConfigError.inlineConfigMergeFailed(
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Merge system prompt configurations
 * Strategy: Append contributors from inline config to base config
 */
function mergeSystemPrompts(
    base: AgentConfig['systemPrompt'],
    override: Partial<AgentConfig['systemPrompt']>
): AgentConfig['systemPrompt'] {
    // If override is a string, replace entirely
    if (typeof override === 'string') {
        return override;
    }

    // If base is a string, convert to object
    const baseObj =
        typeof base === 'string'
            ? {
                  contributors: [
                      { id: 'base', type: 'static' as const, priority: 0, content: base },
                  ],
              }
            : base;

    // If override has contributors, append them
    if (override.contributors) {
        // Copy base contributors (or start with empty array if none)
        const mergedContributors = baseObj.contributors ? Array.from(baseObj.contributors) : [];

        // Add override contributors
        const overrideArray = Array.isArray(override.contributors)
            ? override.contributors
            : [override.contributors];
        overrideArray.forEach((contrib) => {
            if (contrib) {
                mergedContributors.push(contrib);
            }
        });
        return {
            contributors: mergedContributors,
        };
    }

    return baseObj;
}

/**
 * Validate that an agent config is suitable for sub-agent spawning
 * Enforces security constraints
 */
export function validateSubAgentConfig(config: AgentConfig): void {
    // Ensure spawn_agent is not in the tool list (prevent recursion)
    if (config.internalTools?.includes('spawn_agent')) {
        throw ConfigError.invalidSubAgent(
            'Sub-agents cannot have spawn_agent tool enabled to prevent infinite recursion'
        );
    }

    // Ensure ask_user is not enabled (sub-agents shouldn't prompt user)
    if (config.internalTools?.includes('ask_user')) {
        logger.warn(
            'Sub-agent has ask_user tool enabled - this may cause issues as sub-agents should work autonomously'
        );
    }

    logger.debug('Sub-agent config validation passed');
}

/**
 * Get list of available built-in agents
 */
export function getAvailableBuiltInAgents(): readonly BuiltInAgentName[] {
    return BUILT_IN_AGENTS;
}

/**
 * Clear the config cache (useful for testing or hot reload)
 */
export function clearConfigCache(): void {
    configCache.clear();
}

/**
 * Get cache statistics (for monitoring/debugging)
 */
export function getConfigCacheStats() {
    return configCache.getStats();
}
