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
    const backupPath = getDextoPath('backups', agentId);

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
    if (config.storage) {
        enriched.storage = {
            ...config.storage,
            // Enrich database config
            database:
                config.storage.database.type === 'sqlite'
                    ? {
                          ...config.storage.database,
                          path: dbPath,
                      }
                    : config.storage.database,
            // Enrich blob config
            blob:
                config.storage.blob.type === 'local'
                    ? {
                          ...config.storage.blob,
                          storePath: blobPath,
                      }
                    : config.storage.blob,
        };
    }

    // Enrich filesystem config with per-agent backup path (if backups are enabled)
    if (config.internalResources && Array.isArray(config.internalResources)) {
        enriched.internalResources = config.internalResources.map((resource: any) => {
            if (resource.type === 'filesystem' && resource.config?.enableBackups) {
                return {
                    ...resource,
                    config: {
                        ...resource.config,
                        backupPath,
                    },
                };
            }
            return resource;
        });
    }

    return enriched;
}
