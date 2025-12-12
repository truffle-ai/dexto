/**
 * Config Enrichment Layer
 *
 * Provides per-agent path defaults for file-based resources (logs, database, blobs, backups).
 * This layer runs before agent initialization and injects explicit paths
 * into the configuration, eliminating the need for core services to resolve paths themselves.
 *
 * Also discovers command prompts from:
 * - Local: <projectRoot>/commands/ (in dev mode or dexto-project context)
 * - Global: ~/.dexto/commands/
 *
 * Core services now require explicit paths - this enrichment layer provides them.
 */

import { getDextoPath, getDextoGlobalPath } from '../utils/path.js';
import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
} from '../utils/execution-context.js';
import type { AgentConfig } from '@dexto/core';
import * as path from 'path';
import { existsSync, readdirSync } from 'fs';

/**
 * File prompt entry for discovered commands
 */
interface FilePromptEntry {
    type: 'file';
    file: string;
    showInStarters?: boolean;
}

/**
 * Discovers command prompts from local and global commands directories.
 *
 * Directory resolution follows execution context:
 * - dexto-source + DEXTO_DEV_MODE=true: <sourceRoot>/commands/
 * - dexto-source (normal): skip local (use global only)
 * - dexto-project: <projectRoot>/commands/
 * - global-cli: skip local (use global only)
 *
 * Global commands (~/.dexto/commands/) are always included.
 *
 * @returns Array of file prompt entries for discovered .md files
 */
export function discoverCommandPrompts(): FilePromptEntry[] {
    const prompts: FilePromptEntry[] = [];
    const seenFiles = new Set<string>();

    // Determine local commands directory based on context
    const context = getExecutionContext();
    let localCommandsDir: string | null = null;

    switch (context) {
        case 'dexto-source': {
            // Only use local commands in dev mode
            const isDevMode = process.env.DEXTO_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findDextoSourceRoot();
                if (sourceRoot) {
                    localCommandsDir = path.join(sourceRoot, 'commands');
                }
            }
            break;
        }
        case 'dexto-project': {
            const projectRoot = findDextoProjectRoot();
            if (projectRoot) {
                localCommandsDir = path.join(projectRoot, 'commands');
            }
            break;
        }
        case 'global-cli':
            // No local commands for global CLI
            break;
    }

    // Global commands directory
    const globalCommandsDir = getDextoGlobalPath('commands');

    // Scan local commands first (higher priority)
    if (localCommandsDir && existsSync(localCommandsDir)) {
        const files = scanCommandsDirectory(localCommandsDir);
        for (const file of files) {
            const basename = path.basename(file);
            if (!seenFiles.has(basename)) {
                seenFiles.add(basename);
                prompts.push({ type: 'file', file });
            }
        }
    }

    // Scan global commands (lower priority - won't override local)
    if (existsSync(globalCommandsDir)) {
        const files = scanCommandsDirectory(globalCommandsDir);
        for (const file of files) {
            const basename = path.basename(file);
            if (!seenFiles.has(basename)) {
                seenFiles.add(basename);
                prompts.push({ type: 'file', file });
            }
        }
    }

    return prompts;
}

/**
 * Scans a directory for .md command files
 * @param dir Directory to scan
 * @returns Array of absolute file paths
 */
function scanCommandsDirectory(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
                files.push(path.join(dir, entry.name));
            }
        }
    } catch {
        // Directory doesn't exist or can't be read - ignore
    }
    return files;
}

/**
 * Derives an agent ID from config or file path for per-agent isolation.
 * Priority: agentCard.name > filename (without extension) > 'default-agent'
 */
export function deriveAgentId(config: AgentConfig, configPath?: string): string {
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
    return 'default-agent';
}

/**
 * Options for enriching agent configuration
 */
export interface EnrichAgentConfigOptions {
    /** Whether this is interactive CLI mode (affects logger transports - file only vs console+file) */
    isInteractiveCli?: boolean;
    /** Override log level (defaults to 'error' for SDK, CLI/server can override to 'info') */
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
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
    const { isInteractiveCli = false, logLevel = 'error' } = opts;
    const agentId = deriveAgentId(config, configPath);

    // Generate per-agent paths
    const logPath = getDextoPath('logs', `${agentId}.log`);
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
        // Interactive CLI: only file (console would interfere with chat UI)
        // Other modes: console + file
        const transports = isInteractiveCli
            ? [
                  {
                      type: 'file' as const,
                      path: logPath,
                      maxSize: 10 * 1024 * 1024, // 10MB
                      maxFiles: 5,
                  },
              ]
            : [
                  { type: 'console' as const, colorize: true },
                  {
                      type: 'file' as const,
                      path: logPath,
                      maxSize: 10 * 1024 * 1024, // 10MB
                      maxFiles: 5,
                  },
              ];

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

        // Enrich database path if SQLite with empty/missing path
        if (config.storage.database?.type === 'sqlite') {
            enriched.storage.database = {
                ...config.storage.database,
                path: config.storage.database.path || dbPath,
            };
        }
        // Enrich blob path if local with empty/missing storePath
        if (config.storage.blob?.type === 'local') {
            enriched.storage.blob = {
                ...config.storage.blob,
                storePath: config.storage.blob.storePath || blobPath,
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
        // Config prompts take precedence (come first), discovered prompts are appended
        const existingPrompts = config.prompts ?? [];
        enriched.prompts = [...existingPrompts, ...discoveredPrompts];
    }

    return enriched;
}
