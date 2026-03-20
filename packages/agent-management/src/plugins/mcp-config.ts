import { loadBundledMcpConfigFromDirectory } from '@dexto/core';
import type { PluginMCPConfig } from './types.js';

export interface LoadMcpConfigOptions {
    scanNestedMcps?: boolean | undefined;
}

export interface LoadMcpConfigResult {
    mcpConfig?: PluginMCPConfig | undefined;
    warnings: string[];
}

export function loadMcpConfigFromDirectory(
    directoryPath: string,
    ownerName: string,
    options: LoadMcpConfigOptions = {}
): LoadMcpConfigResult {
    const result = loadBundledMcpConfigFromDirectory(directoryPath, ownerName, options);

    return {
        ...(result.mcpServers
            ? { mcpConfig: { mcpServers: result.mcpServers as Record<string, unknown> } }
            : {}),
        warnings: result.warnings,
    };
}
