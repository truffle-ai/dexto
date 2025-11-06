/**
 * CLI Config Enrichment Layer
 *
 * Provides per-agent path defaults for file-based resources (logs, database, blobs, backups).
 * This layer runs in the CLI before agent initialization and injects explicit paths
 * into the configuration, eliminating the need for core services to resolve paths themselves.
 *
 * Core services now require explicit paths - this enrichment layer provides them.
 */

import { getDextoPath } from '@dexto/agent-management';
import type { AgentConfig } from '@dexto/core';
import * as path from 'path';

/**
 * Derives an agent ID from config or file path for per-agent isolation.
 * Priority: agentCard.name > filename (without extension) > 'default-agent'
 */
export function deriveAgentId(config: AgentConfig, configPath?: string): string {
    // 1. Try agentCard.name if available
    if (config.agentCard?.name) {
        // Sanitize name for filesystem use (remove spaces, special chars)
        return config.agentCard.name
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
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
 * Enriches agent configuration with per-agent file paths.
 * This function is called by the CLI before creating the DextoAgent instance.
 *
 * Enrichment adds:
 * - File transport to logger config (per-agent log file)
 * - Full paths to storage config (SQLite database, blob storage)
 * - Backup path to filesystem config (per-agent backups)
 *
 * @param config Agent configuration from YAML file + CLI overrides
 * @param configPath Path to the agent config file (used for agent ID derivation)
 * @returns Enriched configuration with explicit per-agent paths
 */
export function enrichAgentConfig(config: AgentConfig, configPath?: string): AgentConfig {
    const agentId = deriveAgentId(config, configPath);

    // Generate per-agent paths
    const logPath = getDextoPath('logs', `${agentId}.log`);
    const dbPath = getDextoPath('database', `${agentId}.db`);
    const blobPath = getDextoPath('blobs', agentId);

    // Create enriched config (shallow copy with deep updates)
    const enriched: AgentConfig = {
        ...config,
    };

    // Enrich logger config with file transport
    enriched.logger = {
        level: config.logger?.level || 'info',
        transports: [
            // Keep existing console transport or add default
            ...(config.logger?.transports || [{ type: 'console', colorize: true }]),
            // Add file transport with per-agent log path
            {
                type: 'file',
                path: logPath,
                maxSize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5,
            },
        ],
    };

    // Enrich storage config with per-agent paths
    if (!config.storage) {
        // User didn't specify storage - provide filesystem-based defaults
        enriched.storage = {
            cache: { type: 'in-memory' },
            database: { type: 'sqlite', path: dbPath },
            blob: { type: 'local', storePath: blobPath },
        };
    } else {
        // User specified storage - enrich paths where needed, but don't override explicit choices
        enriched.storage = {
            cache: config.storage.cache,
            // Enrich database config: add path to SQLite if missing
            database:
                config.storage.database.type === 'sqlite'
                    ? {
                          ...config.storage.database,
                          path: config.storage.database.path || dbPath,
                      }
                    : config.storage.database,
            // Enrich blob config: add storePath to local if missing
            blob:
                config.storage.blob.type === 'local'
                    ? {
                          ...config.storage.blob,
                          storePath: config.storage.blob.storePath || blobPath,
                      }
                    : config.storage.blob,
        };
    }

    // Note: Filesystem service backup paths are configured separately
    // and not part of agent config. If backup config is added to agent schema
    // in the future, per-agent backup paths can be generated here.

    return enriched;
}
