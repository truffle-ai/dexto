/**
 * Agent Reference Resolver
 *
 * Resolves agent references for spawn_agent tool to agent configurations.
 * Supports two types of references:
 * 1. Built-in agent names ('general-purpose', 'code-reviewer')
 * 2. File paths (relative: './agent.yml', absolute: '/path/to/agent.yml')
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { Stats } from 'fs';
import type { AgentConfig } from '@core/agent/schemas.js';
import { loadAgentConfig } from './loader.js';
import { ConfigError } from './errors.js';
import { logger } from '../logger/index.js';
import { findDextoSourceRoot } from '@core/utils/execution-context.js';
import { getDextoPath } from '@core/utils/path.js';

/**
 * Agent reference types for spawn_agent
 * Currently supports: built-in names and file paths
 *
 * TODO: Add inline config support - allow passing Partial<AgentConfig> objects
 * This would enable spawning sub-agents with inline configuration without requiring
 * separate agent files, useful for quick one-off delegations with custom settings.
 * Implementation requires: merging inline config with defaults, validation, and
 * updating the spawn_agent tool schema to accept union of string | Partial<AgentConfig>
 */
export type AgentReference = string;

/**
 * Known built-in agent names
 */
export const BUILT_IN_AGENTS = ['general-purpose', 'code-reviewer'] as const;

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
        type: 'built-in' | 'file';
        identifier: string; // Agent name or file path
    };
}

/**
 * Config resolution cache
 * Key: cache identifier (built-in name or absolute file path)
 * Value: resolved config with timestamp and optional file mtime
 */
interface CacheEntry {
    config: AgentConfig;
    timestamp: number;
    source: ResolvedAgentConfig['source'];
    /** File modification time (mtime) for file-based configs */
    mtime?: number;
}

class AgentConfigCache {
    private cache = new Map<string, CacheEntry>();
    private readonly ttl: number = 5 * 60 * 1000; // 5 minutes

    /**
     * Get cached config if still valid
     * @param key Cache key
     * @param filePath Optional file path to validate mtime against cached mtime
     */
    async get(key: string, filePath?: string): Promise<AgentConfig | null> {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if cache is still valid (TTL check)
        const age = Date.now() - entry.timestamp;
        if (age > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        // For file-based configs, validate mtime
        if (filePath && entry.mtime !== undefined) {
            try {
                const stats = await fs.stat(filePath);
                const currentMtime = stats.mtimeMs;

                // If file was modified since cache, invalidate
                if (currentMtime !== entry.mtime) {
                    logger.debug(
                        `Cache invalidated for ${key}: file mtime changed (cached: ${entry.mtime}, current: ${currentMtime})`
                    );
                    this.cache.delete(key);
                    return null;
                }
            } catch (error) {
                // If stat fails (file deleted, permissions, etc.), invalidate cache to avoid stale data
                logger.debug(
                    `Cache invalidated for ${key}: stat failed - ${error instanceof Error ? error.message : String(error)}`
                );
                this.cache.delete(key);
                return null;
            }
        }

        logger.debug(`Cache hit for agent config: ${key}`);
        return structuredClone(entry.config);
    }

    /**
     * Store config in cache
     * @param key Cache key
     * @param config Agent config to cache
     * @param source Source metadata
     * @param mtime Optional file modification time for file-based configs
     */
    set(
        key: string,
        config: AgentConfig,
        source: ResolvedAgentConfig['source'],
        mtime?: number
    ): void {
        const entry: CacheEntry = {
            config: structuredClone(config),
            timestamp: Date.now(),
            source,
            ...(mtime !== undefined && { mtime }),
        };
        this.cache.set(key, entry);
        logger.debug(
            `Cached agent config: ${key}${mtime !== undefined ? ` (mtime: ${mtime})` : ''}`
        );
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

    // Resolve string reference (built-in name or file path)
    return await resolveStringReference(reference, context);
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
    const cached = await configCache.get(cacheKey);
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
        return { config: structuredClone(config), source };
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

    // Get file stats (for existence check and mtime)
    let fileStats: Stats;
    try {
        fileStats = await fs.stat(absolutePath);
    } catch {
        throw ConfigError.fileNotFound(absolutePath);
    }

    // Check cache (file-based configs cached by absolute path + mtime)
    const cacheKey = `file:${absolutePath}`;
    const cached = await configCache.get(cacheKey, absolutePath);
    if (cached) {
        return {
            config: cached,
            source: { type: 'file', identifier: filePath },
        };
    }

    // Load config from file
    try {
        const config = await loadAgentConfig(absolutePath);

        // Cache the result with mtime for future validation
        const source = { type: 'file' as const, identifier: filePath };
        configCache.set(cacheKey, config, source, fileStats.mtimeMs);

        logger.info(`Loaded agent config from file: ${filePath}`);
        return { config: structuredClone(config), source };
    } catch (error) {
        throw ConfigError.loadFailed(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }
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

    // Ensure ask_user is not enabled (sub-agents should work autonomously)
    // TODO: Add elicitation support to propagate ask_user requests from sub-agents to parent agent,
    // allowing sub-agents to request clarification from the user through the parent agent
    if (config.internalTools?.includes('ask_user')) {
        throw ConfigError.invalidSubAgent(
            'Sub-agents cannot have ask_user tool enabled - sub-agents must work autonomously without user interaction'
        );
    }

    logger.debug('Sub-agent config validation passed');
}
