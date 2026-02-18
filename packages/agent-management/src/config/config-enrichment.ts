/**
 * Config Enrichment Layer
 *
 * Provides per-agent path defaults for file-based resources (logs, database, blobs, backups).
 * This layer runs before agent initialization and injects explicit paths
 * into the configuration, eliminating the need for core services to resolve paths themselves.
 *
 * Also discovers command prompts from (in priority order):
 * - Local: <projectRoot>/commands/ (dexto-source dev mode or dexto-project only)
 * - Local: <cwd>/.dexto/commands/
 * - Global: ~/.dexto/commands/
 *
 * Core services now require explicit paths - this enrichment layer provides them.
 */

import { getDextoPath } from '../utils/path.js';
import type { AgentConfig } from '@dexto/agent-config';
import * as path from 'path';
import { discoverCommandPrompts, discoverAgentInstructionFile } from './discover-prompts.js';
import {
    discoverClaudeCodePlugins,
    loadClaudeCodePlugin,
    discoverStandaloneSkills,
} from '../plugins/index.js';

// Re-export for backwards compatibility
export { discoverCommandPrompts, discoverAgentInstructionFile } from './discover-prompts.js';

/**
 * Derives an agent ID from config or file path for per-agent isolation.
 * Priority: explicit agentId > agentCard.name > filename (without extension) > 'coding-agent'
 */
export function deriveAgentId(config: AgentConfig, configPath?: string): string {
    // 0. If agentId is explicitly set in config, use it (highest priority)
    if (config.agentId) {
        // Sanitize for filesystem use (same as agentCard.name)
        const sanitizedId = config.agentId
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return sanitizedId || 'coding-agent';
    }

    // 1. Try agentCard.name if available
    if (config.agentCard?.name) {
        // Sanitize name for filesystem use (remove spaces, special chars)
        const sanitizedName = config.agentCard.name
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (sanitizedName) {
            return sanitizedName;
        }
    }

    // 2. Try filename (without extension)
    if (configPath) {
        const basename = path.basename(configPath, path.extname(configPath));
        if (basename && basename !== 'agent' && basename !== 'config') {
            return basename;
        }
    }

    // 3. Fallback to default
    return 'coding-agent';
}

/**
 * Options for enriching agent configuration
 */
export interface EnrichAgentConfigOptions {
    /** Whether this is interactive CLI mode (affects logger transports - file only vs console+file) */
    isInteractiveCli?: boolean;
    /** Override log level (defaults to 'error' for SDK, CLI/server can override to 'info') */
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
    /** Skip Claude Code plugin discovery (useful for subagents that don't need plugins) */
    skipPluginDiscovery?: boolean;
    /**
     * Bundled plugin paths from image definition.
     * These are absolute paths to plugin directories that are discovered alongside
     * user/project plugins.
     */
    bundledPlugins?: string[];
    /**
     * When true, override relative storage paths (database/blob) with per-agent
     * dexto paths. This is useful in desktop/runtime contexts where writing to
     * the app cwd is undesirable.
     */
    forceStoragePaths?: boolean;
}

/**
 * Enriches agent configuration with per-agent file paths and discovered commands.
 * This function is called before creating the DextoAgent instance.
 *
 * Enrichment adds:
 * - File transport to logger config (per-agent log file)
 * - Full paths to storage config (SQLite database, blob storage)
 * - Backup path to filesystem config (per-agent backups)
 * - Discovered command prompts from local/global commands/ directories
 *
 * @param config Agent configuration from YAML file + CLI overrides
 * @param configPath Path to the agent config file (used for agent ID derivation)
 * @param options Enrichment options (isInteractiveCli, logLevel)
 * @returns Enriched configuration with explicit per-agent paths and discovered prompts
 */
export function enrichAgentConfig(
    config: AgentConfig,
    configPath?: string,
    options: EnrichAgentConfigOptions | boolean = {}
): AgentConfig {
    // Handle backward compatibility: boolean arg was isInteractiveCli
    const opts: EnrichAgentConfigOptions =
        typeof options === 'boolean' ? { isInteractiveCli: options } : options;
    const {
        isInteractiveCli = false,
        logLevel = 'error',
        skipPluginDiscovery = false,
        bundledPlugins = [],
        forceStoragePaths = false,
    } = opts;
    const agentId = deriveAgentId(config, configPath);

    // Generate per-agent paths
    // Note: file logging is session-scoped (see core SessionManager) so we don't set a per-agent log file here.
    const dbPath = getDextoPath('database', `${agentId}.db`);
    const blobPath = getDextoPath('blobs', agentId);

    // Create enriched config (shallow copy with deep updates)
    const enriched: AgentConfig = {
        ...config,
        agentId, // Set agentId explicitly (single source of truth)
    };

    // Enrich logger config: only provide if not set
    if (!config.logger) {
        // User didn't specify logger - provide defaults based on mode
        // Interactive CLI: console transport is disabled to prevent interference with Ink UI
        // File logging is session-scoped (see core SessionManager), so we do NOT add a file transport here.
        const transports = isInteractiveCli
            ? [{ type: 'silent' as const }]
            : [{ type: 'console' as const, colorize: true }];

        enriched.logger = {
            level: logLevel,
            transports,
        };
    } else {
        // User specified logger - keep their config as-is
        enriched.logger = config.logger;
    }

    // Enrich storage config with per-agent paths
    if (!config.storage) {
        // User didn't specify storage at all - provide filesystem-based defaults
        enriched.storage = {
            cache: { type: 'in-memory' },
            database: { type: 'sqlite', path: dbPath },
            blob: { type: 'local', storePath: blobPath },
        };
    } else {
        // User specified storage - start with their config, enrich paths where needed
        enriched.storage = {
            ...config.storage,
        };

        // Enrich database path if SQLite with empty/missing path (or force override for relative paths)
        if (config.storage.database?.type === 'sqlite') {
            const databasePath =
                typeof config.storage.database.path === 'string'
                    ? config.storage.database.path
                    : undefined;
            const shouldOverride =
                !databasePath || (forceStoragePaths && !path.isAbsolute(databasePath));
            enriched.storage.database = {
                ...config.storage.database,
                path: shouldOverride ? dbPath : databasePath,
            };
        }
        // Enrich blob path if local with empty/missing storePath (or force override for relative paths)
        if (config.storage.blob?.type === 'local') {
            const blobStorePath =
                typeof config.storage.blob.storePath === 'string'
                    ? config.storage.blob.storePath
                    : undefined;
            const shouldOverride =
                !blobStorePath || (forceStoragePaths && !path.isAbsolute(blobStorePath));
            enriched.storage.blob = {
                ...config.storage.blob,
                storePath: shouldOverride ? blobPath : blobStorePath,
            };
        }
    }

    // Note: Filesystem service backup paths are configured separately
    // and not part of agent config. If backup config is added to agent schema
    // in the future, per-agent backup paths can be generated here.

    // Discover and merge command prompts from commands/ directories
    const discoveredPrompts = discoverCommandPrompts();
    if (discoveredPrompts.length > 0) {
        // Merge discovered prompts with existing config prompts
        // Config prompts take precedence - deduplicate by file path to avoid
        // metadata/content mismatch when same file appears in both arrays
        const existingPrompts = config.prompts ?? [];

        // Build set of existing file paths (normalized for comparison)
        const existingFilePaths = new Set<string>();
        for (const prompt of existingPrompts) {
            if (prompt.type === 'file') {
                // Normalize path for cross-platform comparison
                existingFilePaths.add(path.resolve(prompt.file));
            }
        }

        // Filter out discovered prompts that already exist in config
        const filteredDiscovered = discoveredPrompts.filter(
            (p) => !existingFilePaths.has(path.resolve(p.file))
        );

        enriched.prompts = [...existingPrompts, ...filteredDiscovered];
    }

    // Discover and load Claude Code plugins (skip for subagents to avoid duplicate warnings)
    if (!skipPluginDiscovery) {
        // Build set of existing file paths for deduplication
        // This prevents duplicate prompts when same file appears in config and plugins/skills
        const existingPromptPaths = new Set<string>();
        for (const prompt of enriched.prompts ?? []) {
            if (prompt.type === 'file') {
                existingPromptPaths.add(path.resolve(prompt.file));
            }
        }

        const discoveredPlugins = discoverClaudeCodePlugins(undefined, bundledPlugins);
        for (const plugin of discoveredPlugins) {
            const loaded = loadClaudeCodePlugin(plugin);

            // Log warnings for unsupported features
            // Note: Logging happens at enrichment time since we don't have a logger instance
            // Warnings are stored in the loaded plugin and can be accessed by callers
            for (const warning of loaded.warnings) {
                console.warn(`[plugin] ${warning}`);
            }

            // Add commands/skills as prompts with namespace
            // Note: Both commands and skills are user-invocable by default (per schema).
            // SKILL.md frontmatter can override with `user-invocable: false` if needed.
            for (const cmd of loaded.commands) {
                const resolvedPath = path.resolve(cmd.file);
                if (existingPromptPaths.has(resolvedPath)) {
                    continue; // Skip duplicate
                }
                existingPromptPaths.add(resolvedPath);

                const promptEntry = {
                    type: 'file' as const,
                    file: cmd.file,
                    namespace: cmd.namespace,
                };

                // Add to enriched prompts
                enriched.prompts = enriched.prompts ?? [];
                enriched.prompts.push(promptEntry);
            }

            // Merge MCP config into mcpServers
            // Note: Plugin MCP config is loosely typed; users are responsible for valid server configs
            if (loaded.mcpConfig?.mcpServers) {
                enriched.mcpServers = {
                    ...enriched.mcpServers,
                    ...(loaded.mcpConfig.mcpServers as typeof enriched.mcpServers),
                };
            }
        }

        // Discover standalone skills from ~/.agents/skills/, ~/.dexto/skills/,
        // <cwd>/.agents/skills/, and <cwd>/.dexto/skills/
        // These are bare skill directories with SKILL.md files (not full plugins)
        // Unlike plugin commands, standalone skills don't need namespace prefixing -
        // the id from frontmatter or directory name is used directly.
        const standaloneSkills = discoverStandaloneSkills();
        for (const skill of standaloneSkills) {
            const resolvedPath = path.resolve(skill.skillFile);
            if (existingPromptPaths.has(resolvedPath)) {
                continue; // Skip duplicate
            }
            existingPromptPaths.add(resolvedPath);

            const promptEntry = {
                type: 'file' as const,
                file: skill.skillFile,
                // No namespace for standalone skills - they use id directly
                // (unlike plugin commands which need plugin:command naming)
            };

            enriched.prompts = enriched.prompts ?? [];
            enriched.prompts.push(promptEntry);
        }
    }

    const shouldDiscoverAgentInstructions =
        config.agentFile?.discoverInCwd !== undefined ? config.agentFile.discoverInCwd : true;

    // Discover agent instruction file (AGENTS.md, CLAUDE.md, GEMINI.md) in cwd
    // Add as a file contributor to system prompt if found
    const instructionFile = shouldDiscoverAgentInstructions ? discoverAgentInstructionFile() : null;
    if (instructionFile) {
        // Add file contributor to system prompt config
        // Use a low priority (5) so it runs early but after any base prompt
        const fileContributor = {
            id: 'discovered-instructions',
            type: 'file' as const,
            priority: 5,
            enabled: true,
            files: [instructionFile],
            options: {
                includeFilenames: true,
                errorHandling: 'skip' as const,
                maxFileSize: 100000,
            },
        };

        // Handle different systemPrompt config shapes
        if (!config.systemPrompt) {
            // No system prompt - create one with just the file contributor
            enriched.systemPrompt = {
                contributors: [fileContributor],
            };
        } else if (typeof config.systemPrompt === 'string') {
            // String system prompt - convert to object with both static and file contributors
            enriched.systemPrompt = {
                contributors: [
                    {
                        id: 'inline',
                        type: 'static' as const,
                        content: config.systemPrompt,
                        priority: 0,
                        enabled: true,
                    },
                    fileContributor,
                ],
            };
        } else if ('contributors' in config.systemPrompt) {
            // Already structured - add file contributor if not already present
            const existingContributors = config.systemPrompt.contributors ?? [];
            const hasDiscoveredInstructions = existingContributors.some(
                (c) => c.id === 'discovered-instructions'
            );
            if (!hasDiscoveredInstructions) {
                enriched.systemPrompt = {
                    contributors: [...existingContributors, fileContributor],
                };
            }
        }
    }

    return enriched;
}
