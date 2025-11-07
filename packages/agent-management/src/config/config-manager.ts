import { promises as fs } from 'fs';
import { parseDocument } from 'yaml';
import { loadAgentConfig } from './loader.js';
import type { AgentConfig, ValidatedAgentConfig } from '@dexto/core';
import { AgentConfigSchema } from '@dexto/core';
import { DextoValidationError } from '@dexto/core';
import { fail, zodToIssues } from '@dexto/core';

/**
 * Updates an agent configuration file with partial updates.
 * Reads raw YAML, merges updates, validates, and writes back atomically.
 * Preserves comments, formatting, and environment variable placeholders.
 *
 * This is a CLI/server concern - handles file I/O for config updates.
 * After calling this, you should call agent.reloadConfig() with the returned config.
 *
 * @param configPath Path to the agent configuration file
 * @param updates Partial configuration updates to apply
 * @returns The validated merged configuration
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
 * const reloadResult = await agent.reloadConfig(newConfig);
 * if (reloadResult.restartRequired.length > 0) {
 *   await agent.restart();
 * }
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

    // Shallow merge top-level updates
    const updatedRawConfig = { ...rawConfig, ...updates };

    // Validate merged config
    const parsed = AgentConfigSchema.safeParse(updatedRawConfig);
    if (!parsed.success) {
        // Convert Zod errors to DextoValidationError
        const result = fail(zodToIssues(parsed.error, 'error'));
        throw new DextoValidationError(result.issues);
    }

    // Apply updates to the YAML document (preserves formatting/comments)
    for (const [key, value] of Object.entries(updates)) {
        doc.set(key, value);
    }

    // Serialize the Document back to YAML
    const yamlContent = String(doc);

    // Atomic write: write to temp file then rename
    const tmpPath = `${configPath}.tmp`;
    await fs.writeFile(tmpPath, yamlContent, 'utf-8');
    await fs.rename(tmpPath, configPath);

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
