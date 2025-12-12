import { promises as fs } from 'fs';
import { parseDocument, stringify } from 'yaml';
import { loadAgentConfig } from './loader.js';
import { enrichAgentConfig } from './config-enrichment.js';
import type { AgentConfig, ValidatedAgentConfig } from '@dexto/core';
import { AgentConfigSchema } from '@dexto/core';
import { DextoValidationError } from '@dexto/core';
import { fail, zodToIssues } from '@dexto/core';

/**
 * Input type for adding a file-based prompt
 */
export interface FilePromptInput {
    type: 'file';
    file: string;
    showInStarters?: boolean;
}

/**
 * Input type for adding an inline prompt
 */
export interface InlinePromptInput {
    type: 'inline';
    id: string;
    prompt: string;
    title?: string;
    description?: string;
    category?: string;
    priority?: number;
    showInStarters?: boolean;
}

export type PromptInput = FilePromptInput | InlinePromptInput;

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

// ============================================================================
// Surgical Config Mutation Helpers
// These functions modify specific parts of the config without affecting others
// ============================================================================

/**
 * Helper to write file atomically
 */
async function writeFileAtomic(configPath: string, content: string): Promise<void> {
    const tmpPath = `${configPath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, configPath);
}

/**
 * Finds the end position of the prompts array in the YAML file.
 * Returns the line index where we should insert a new prompt entry.
 */
function findPromptsArrayEndPosition(
    lines: string[]
): { insertIndex: number; indent: string } | null {
    let inPromptsSection = false;
    let promptsIndent = '';
    let lastPromptEntryEnd = -1;
    let itemIndent = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        // Find the start of prompts section
        if (trimmed.startsWith('prompts:')) {
            inPromptsSection = true;
            const idx = line.indexOf('prompts:');
            promptsIndent = idx >= 0 ? line.slice(0, idx) : '';
            continue;
        }

        if (inPromptsSection) {
            // Check if we've exited the prompts section (new top-level key)
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
                const currentIndent = line.slice(0, line.length - trimmed.length);
                if (currentIndent.length <= promptsIndent.length && trimmed.includes(':')) {
                    // We've hit a new section at same or lower indent level
                    return { insertIndex: lastPromptEntryEnd + 1, indent: itemIndent };
                }
            }

            // Track array items (- type: ...)
            if (trimmed.startsWith('- ')) {
                const dashIdx = line.indexOf('-');
                itemIndent = dashIdx >= 0 ? line.slice(0, dashIdx) : '';
                lastPromptEntryEnd = i;
            } else if (lastPromptEntryEnd >= 0 && trimmed && !trimmed.startsWith('#')) {
                // Content continuation of current item
                lastPromptEntryEnd = i;
            }
        }
    }

    // If we reached end of file while in prompts section
    if (inPromptsSection && lastPromptEntryEnd >= 0) {
        return { insertIndex: lastPromptEntryEnd + 1, indent: itemIndent };
    }

    return null;
}

/**
 * Adds a prompt to the agent configuration file.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 * Only modifies the prompts array by appending a new entry.
 *
 * @param configPath Path to the agent configuration file
 * @param prompt The prompt to add (file or inline)
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * // Add a file-based prompt
 * await addPromptToAgentConfig('/path/to/agent.yml', {
 *   type: 'file',
 *   file: '${{dexto.agent_dir}}/prompts/my-prompt.md'
 * });
 * ```
 */
export async function addPromptToAgentConfig(
    configPath: string,
    prompt: PromptInput
): Promise<void> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const position = findPromptsArrayEndPosition(lines);

    if (position) {
        // Format the new prompt entry
        const promptYaml = stringify([prompt], { indent: 2, lineWidth: 0 }).trim();
        // The stringify gives us "- type: file\n  file: ...", we need to indent it
        const indentedPrompt = promptYaml
            .split('\n')
            .map((line) => position.indent + line)
            .join('\n');

        // Insert the new prompt
        lines.splice(position.insertIndex, 0, indentedPrompt);
    } else {
        // No prompts section found - append one at the end
        const promptYaml = stringify({ prompts: [prompt] }, { indent: 2, lineWidth: 0 }).trim();
        lines.push('', promptYaml);
    }

    await writeFileAtomic(configPath, lines.join('\n'));
}

/**
 * Finds the line ranges of prompt entries in the prompts array.
 * Each entry is a range [startLine, endLine] (inclusive).
 */
function findPromptEntryRanges(
    lines: string[]
): Array<{ startLine: number; endLine: number; content: string }> {
    const entries: Array<{ startLine: number; endLine: number; content: string }> = [];
    let inPromptsSection = false;
    let promptsIndent = '';
    let currentEntryStart = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        // Find the start of prompts section
        if (trimmed.startsWith('prompts:')) {
            inPromptsSection = true;
            const idx = line.indexOf('prompts:');
            promptsIndent = idx >= 0 ? line.slice(0, idx) : '';
            continue;
        }

        if (inPromptsSection) {
            // Check if we've exited the prompts section (new top-level key)
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
                const currentIndent = line.slice(0, line.length - trimmed.length);
                if (currentIndent.length <= promptsIndent.length && trimmed.includes(':')) {
                    // We've hit a new section - close any open entry
                    if (currentEntryStart >= 0) {
                        entries.push({
                            startLine: currentEntryStart,
                            endLine: i - 1,
                            content: lines.slice(currentEntryStart, i).join('\n'),
                        });
                    }
                    break;
                }
            }

            // Track array items (- type: ...)
            if (trimmed.startsWith('- ')) {
                // Close previous entry if any
                if (currentEntryStart >= 0) {
                    entries.push({
                        startLine: currentEntryStart,
                        endLine: i - 1,
                        content: lines.slice(currentEntryStart, i).join('\n'),
                    });
                }
                currentEntryStart = i;
            }
        }
    }

    // Close final entry if still open
    if (currentEntryStart >= 0) {
        // Find the actual end (skip trailing empty lines)
        let endLine = lines.length - 1;
        while (endLine > currentEntryStart && !(lines[endLine] ?? '').trim()) {
            endLine--;
        }
        entries.push({
            startLine: currentEntryStart,
            endLine,
            content: lines.slice(currentEntryStart, endLine + 1).join('\n'),
        });
    }

    return entries;
}

/**
 * Removes a prompt from the agent configuration file.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 * Only removes the matching prompt entry lines.
 *
 * For file prompts: matches by file path pattern
 * For inline prompts: matches by id
 *
 * @param configPath Path to the agent configuration file
 * @param matcher Criteria to match prompts to remove
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * // Remove by file path pattern
 * await removePromptFromAgentConfig('/path/to/agent.yml', {
 *   type: 'file',
 *   filePattern: '/prompts/my-prompt.md'
 * });
 *
 * // Remove by inline prompt id
 * await removePromptFromAgentConfig('/path/to/agent.yml', {
 *   type: 'inline',
 *   id: 'quick-help'
 * });
 * ```
 */
export async function removePromptFromAgentConfig(
    configPath: string,
    matcher: { type: 'file'; filePattern: string } | { type: 'inline'; id: string }
): Promise<void> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const entries = findPromptEntryRanges(lines);
    if (entries.length === 0) {
        return; // No prompts to remove
    }

    // Find entries to remove based on matcher
    const entriesToRemove: Array<{ startLine: number; endLine: number }> = [];

    for (const entry of entries) {
        if (matcher.type === 'file') {
            // Check if this entry contains the file pattern
            if (
                entry.content.includes('type: file') &&
                entry.content.includes(matcher.filePattern)
            ) {
                entriesToRemove.push(entry);
            }
        } else if (matcher.type === 'inline') {
            // Check if this entry has the matching id
            if (
                entry.content.includes('type: inline') &&
                entry.content.includes(`id: ${matcher.id}`)
            ) {
                entriesToRemove.push(entry);
            }
        }
    }

    if (entriesToRemove.length === 0) {
        return; // Nothing to remove
    }

    // Remove entries in reverse order to maintain correct indices
    const sortedEntries = [...entriesToRemove].sort((a, b) => b.startLine - a.startLine);
    for (const entry of sortedEntries) {
        lines.splice(entry.startLine, entry.endLine - entry.startLine + 1);
    }

    await writeFileAtomic(configPath, lines.join('\n'));
}
