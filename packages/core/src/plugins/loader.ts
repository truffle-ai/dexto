import { isAbsolute } from 'path';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from './error-codes.js';

/**
 * Validate that a loaded plugin implements the DextoPlugin interface correctly
 * Performs runtime checks that complement TypeScript's compile-time type checking
 *
 * @param PluginClass - The plugin class constructor
 * @param pluginName - Name for error messages
 * @throws {DextoRuntimeError} If validation fails
 */
export function validatePluginShape(PluginClass: any, pluginName: string): void {
    // 1. Check it's a class/constructor function
    if (typeof PluginClass !== 'function') {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_INVALID_SHAPE,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin '${pluginName}' default export must be a class or constructor function`
        );
    }

    // 2. Try to instantiate to check constructor
    let instance: any;
    try {
        instance = new PluginClass();
    } catch (error) {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_INSTANTIATION_FAILED,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Failed to instantiate plugin '${pluginName}': ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // 3. Check it has at least one extension point method
    const extensionPoints = [
        'beforeLLMRequest',
        'beforeToolCall',
        'afterToolResult',
        'beforeResponse',
    ];

    const hasExtensionPoint = extensionPoints.some(
        (point) => typeof instance[point] === 'function'
    );

    if (!hasExtensionPoint) {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_INVALID_SHAPE,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin '${pluginName}' must implement at least one extension point method`,
            { availableExtensionPoints: extensionPoints }
        );
    }

    // 4. Validate initialize if present
    if (instance.initialize !== undefined && typeof instance.initialize !== 'function') {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_INVALID_SHAPE,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin '${pluginName}' initialize property must be a function (found ${typeof instance.initialize})`
        );
    }

    // 5. Validate cleanup if present
    if (instance.cleanup !== undefined && typeof instance.cleanup !== 'function') {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_INVALID_SHAPE,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin '${pluginName}' cleanup property must be a function (found ${typeof instance.cleanup})`
        );
    }
}

/**
 * Resolve and validate plugin module path
 * Ensures path is absolute after template variable expansion
 *
 * @param modulePath - Path from config (after template expansion)
 * @param configDir - Directory containing agent config (for validation context)
 * @returns Resolved absolute path
 * @throws {DextoRuntimeError} If path is not absolute
 */
export function resolvePluginPath(modulePath: string, configDir: string): string {
    // Path should already be absolute after template expansion in config loader
    // We just validate it here
    if (!isAbsolute(modulePath)) {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            "Plugin module path must be absolute (got '" +
                modulePath +
                "'). Use ${{dexto.agent_dir}} template variable for agent-relative paths.",
            {
                modulePath,
                configDir,
                hint: 'Example: module: "${{dexto.agent_dir}}/plugins/my-plugin.ts"',
            }
        );
    }

    return modulePath;
}

/**
 * Load a plugin from a module path
 * Supports both .ts (via tsx) and .js files
 *
 * @param modulePath - Absolute path to plugin module
 * @param pluginName - Name for error messages
 * @returns Plugin class constructor
 * @throws {DextoRuntimeError} If loading or validation fails
 */
export async function loadPluginModule(modulePath: string, pluginName: string): Promise<any> {
    try {
        // Dynamic import supports both .ts and .js
        // .ts files require tsx loader or pre-compilation
        const pluginModule = await import(modulePath);

        // Check for default export
        const PluginClass = pluginModule.default;

        if (!PluginClass) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_INVALID_SHAPE,
                ErrorScope.PLUGIN,
                ErrorType.USER,
                `Plugin '${pluginName}' at '${modulePath}' has no default export. ` +
                    `Ensure your plugin exports a class as default.`,
                { modulePath, pluginName }
            );
        }

        // Validate plugin shape
        validatePluginShape(PluginClass, pluginName);

        return PluginClass;
    } catch (error) {
        // Re-throw our own errors
        if (error instanceof DextoRuntimeError) {
            throw error;
        }

        // Wrap other errors (import failures, etc.)
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_LOAD_FAILED,
            ErrorScope.PLUGIN,
            ErrorType.SYSTEM,
            `Failed to load plugin '${pluginName}' from '${modulePath}': ${
                error instanceof Error ? error.message : String(error)
            }`,
            {
                modulePath,
                pluginName,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }
}
