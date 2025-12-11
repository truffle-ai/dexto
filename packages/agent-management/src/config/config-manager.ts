import { promises as fs } from 'fs';
import { parseDocument } from 'yaml';
import { loadAgentConfig } from './loader.js';
import { enrichAgentConfig } from './config-enrichment.js';
import type { AgentConfig, ValidatedAgentConfig } from '@dexto/core';
import { AgentConfigSchema } from '@dexto/core';
import { DextoValidationError } from '@dexto/core';
import { fail, zodToIssues } from '@dexto/core';

/**
 * Updates an agent configuration file with partial updates.
 * Reads raw YAML, merges updates, enriches for validation, and writes back atomically.
 * Preserves comments, formatting, and environment variable placeholders.
 *
 * Note: The file is kept "raw" (no enriched paths written), but the returned config
 * is enriched and validated so it can be passed directly to agent.reload().
 *
 * This is a CLI/server concern - handles file I/O for config updates.
 * After calling this, you should call agent.reload() with the returned config.
 *
 * @param configPath Path to the agent configuration file
 * @param updates Partial configuration updates to apply
 * @returns The validated, enriched merged configuration (ready for agent.reload())
 * @throws DextoValidationError if validation fails
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * const newConfig = await updateAgentConfigFile('/path/to/agent.yml', {
 *   mcpServers: {
 *     ...currentConfig.mcpServers,
 *     newServer: { command: 'mcp-server', type: 'stdio' }
 *   }
 * });
 *
 * const reloadResult = await agent.reload(newConfig);
 * ```
 */
export async function updateAgentConfigFile(
    configPath: string,
    updates: Partial<AgentConfig>
): Promise<ValidatedAgentConfig> {
    // Read raw YAML from disk (without env var expansion)
    const rawYaml = await fs.readFile(configPath, 'utf-8');

    // Use YAML Document API to preserve comments/anchors/formatting
    const doc = parseDocument(rawYaml);
    const rawConfig = doc.toJSON() as Record<string, unknown>;

    // Shallow merge top-level updates into raw config
    const updatedRawConfig = { ...rawConfig, ...updates } as AgentConfig;

    // Enrich the merged config (adds storage paths, logger defaults, etc.)
    // This is required because AgentConfigSchema expects enriched fields
    const enrichedConfig = enrichAgentConfig(updatedRawConfig, configPath);

    // Validate the enriched config
    const parsed = AgentConfigSchema.safeParse(enrichedConfig);
    if (!parsed.success) {
        // Convert Zod errors to DextoValidationError
        const result = fail(zodToIssues(parsed.error, 'error'));
        throw new DextoValidationError(result.issues);
    }

    // Apply ONLY the updates to the YAML document (preserves formatting/comments)
    // We don't write enriched fields - the file stays "raw"
    for (const [key, value] of Object.entries(updates)) {
        doc.set(key, value);
    }

    // Serialize the Document back to YAML
    const yamlContent = String(doc);

    // Atomic write: write to temp file then rename
    const tmpPath = `${configPath}.tmp`;
    await fs.writeFile(tmpPath, yamlContent, 'utf-8');
    await fs.rename(tmpPath, configPath);

    // Return the enriched, validated config (ready for agent.reload())
    return parsed.data;
}

/**
 * Reloads an agent configuration from disk.
 * This is a CLI/server concern - handles file I/O for config loading.
 * After calling this, you should call agent.reloadConfig() with the returned config.
 *
 * @param configPath Path to the agent configuration file
 * @returns The loaded agent configuration
 * @throws ConfigError if file cannot be read or parsed
 *
 * @example
 * ```typescript
 * const newConfig = await reloadAgentConfigFromFile('/path/to/agent.yml');
 * const reloadResult = await agent.reloadConfig(newConfig);
 * if (reloadResult.restartRequired.length > 0) {
 *   await agent.restart();
 * }
 * ```
 */
export async function reloadAgentConfigFromFile(configPath: string): Promise<AgentConfig> {
    return await loadAgentConfig(configPath);
}
