/**
 * Config Enrichment Layer
 *
 * Provides per-agent path defaults for file-based resources (logs, database, blobs, backups).
 * This layer runs before agent initialization and injects explicit paths
 * into the configuration, eliminating the need for core services to resolve paths themselves.
 *
 * Core services now require explicit paths - this enrichment layer provides them.
 */

import { getDextoPath } from '../utils/path.js';
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
 * Enriches agent configuration with per-agent file paths.
 * This function is called before creating the DextoAgent instance.
 *
 * Enrichment adds:
 * - File transport to logger config (per-agent log file)
 * - Full paths to storage config (SQLite database, blob storage)
 * - Backup path to filesystem config (per-agent backups)
 *
 * @param config Agent configuration from YAML file + CLI overrides
 * @param configPath Path to the agent config file (used for agent ID derivation)
 * @param isInteractiveCli Whether this is interactive CLI mode (affects logger defaults) - defaults to false
 * @returns Enriched configuration with explicit per-agent paths
 */
export function enrichAgentConfig(
    config: AgentConfig,
    configPath?: string,
    isInteractiveCli: boolean = false
): AgentConfig {
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
            level: 'info',
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

    return enriched;
}
