import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { PluginErrorCode } from './error-codes.js';

/**
 * Plugin runtime error factory methods
 * Creates properly typed errors for plugin operations
 */
export class PluginError {
    // Manifest errors
    static manifestNotFound(pluginPath: string) {
        return new DextoRuntimeError(
            PluginErrorCode.MANIFEST_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Plugin manifest not found: ${pluginPath}/.claude-plugin/plugin.json`,
            { pluginPath },
            'Ensure the plugin has a valid .claude-plugin/plugin.json file'
        );
    }

    static manifestInvalid(pluginPath: string, issues: string) {
        return new DextoRuntimeError(
            PluginErrorCode.MANIFEST_INVALID,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid plugin manifest at ${pluginPath}: ${issues}`,
            { pluginPath, issues },
            'Check the plugin.json file matches the expected schema (name is required)'
        );
    }

    static manifestParseError(pluginPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.MANIFEST_PARSE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Failed to parse plugin manifest at ${pluginPath}: ${cause}`,
            { pluginPath, cause },
            'Ensure plugin.json contains valid JSON'
        );
    }

    // Loading errors
    static directoryReadError(pluginPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.DIRECTORY_READ_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to read plugin directory ${pluginPath}: ${cause}`,
            { pluginPath, cause },
            'Check file permissions and that the directory exists'
        );
    }

    static mcpConfigInvalid(pluginPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.MCP_CONFIG_INVALID,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid MCP config in plugin ${pluginPath}: ${cause}`,
            { pluginPath, cause },
            'Check the .mcp.json file contains valid JSON'
        );
    }
}
