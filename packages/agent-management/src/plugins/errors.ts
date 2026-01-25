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

    // Installation errors
    static installSourceNotFound(sourcePath: string) {
        return new DextoRuntimeError(
            PluginErrorCode.INSTALL_SOURCE_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Plugin source not found: ${sourcePath}`,
            { sourcePath },
            'Ensure the path points to a valid plugin directory with .claude-plugin/plugin.json'
        );
    }

    static installAlreadyExists(pluginName: string, existingPath: string) {
        return new DextoRuntimeError(
            PluginErrorCode.INSTALL_ALREADY_EXISTS,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Plugin '${pluginName}' is already installed at ${existingPath}`,
            { pluginName, existingPath },
            'Use --force to overwrite the existing installation'
        );
    }

    static installCopyFailed(sourcePath: string, destPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.INSTALL_COPY_FAILED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to copy plugin from ${sourcePath} to ${destPath}: ${cause}`,
            { sourcePath, destPath, cause },
            'Check file permissions and disk space'
        );
    }

    static installManifestWriteFailed(manifestPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.INSTALL_MANIFEST_WRITE_FAILED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to update installed plugins manifest at ${manifestPath}: ${cause}`,
            { manifestPath, cause },
            'Check file permissions and ensure the directory exists'
        );
    }

    static invalidScope(scope: unknown) {
        return new DextoRuntimeError(
            PluginErrorCode.INSTALL_INVALID_SCOPE,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid installation scope: ${scope}. Must be 'user', 'project', or 'local'.`,
            { scope },
            "Check the scope parameter is one of: 'user', 'project', 'local'"
        );
    }

    // Uninstallation errors
    static uninstallNotFound(pluginName: string, hint?: string) {
        return new DextoRuntimeError(
            PluginErrorCode.UNINSTALL_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Plugin '${pluginName}' is not installed`,
            { pluginName },
            hint || 'Use `dexto plugin list` to see installed plugins'
        );
    }

    static uninstallDeleteFailed(pluginPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.UNINSTALL_DELETE_FAILED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to delete plugin at ${pluginPath}: ${cause}`,
            { pluginPath, cause },
            'Check file permissions and ensure the plugin is not in use'
        );
    }

    static uninstallManifestUpdateFailed(manifestPath: string, cause: string) {
        return new DextoRuntimeError(
            PluginErrorCode.UNINSTALL_MANIFEST_UPDATE_FAILED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to update installed plugins manifest at ${manifestPath}: ${cause}`,
            { manifestPath, cause },
            'Check file permissions'
        );
    }

    // Validation errors
    static validationInvalidStructure(pluginPath: string, details: string) {
        return new DextoRuntimeError(
            PluginErrorCode.VALIDATION_INVALID_STRUCTURE,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid plugin structure at ${pluginPath}: ${details}`,
            { pluginPath, details },
            'Ensure the plugin has a .claude-plugin/plugin.json file'
        );
    }

    static validationMissingRequired(pluginPath: string, missing: string[]) {
        return new DextoRuntimeError(
            PluginErrorCode.VALIDATION_MISSING_REQUIRED,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Plugin at ${pluginPath} is missing required fields: ${missing.join(', ')}`,
            { pluginPath, missing },
            'Add the missing fields to .claude-plugin/plugin.json'
        );
    }
}
