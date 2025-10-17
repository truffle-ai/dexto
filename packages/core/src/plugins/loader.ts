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
        // TODO: Replace tsx runtime loader with build-time bundling for production
        // SHORT-TERM: tsx provides on-the-fly TypeScript loading for development
        // LONG-TERM: Implement `dexto bundle` CLI command that:
        //   1. Parses agent config to discover all plugins
        //   2. Generates static imports: import tenantAuth from './plugins/tenant-auth.js'
        //   3. Creates plugin registry: { 'tenant-auth': tenantAuth }
        //   4. Bundles with esbuild/tsup into single artifact
        //   5. Loads from registry in production (no runtime compilation)
        // Benefits: Zero runtime overhead, works in serverless, smaller bundle size
        // See: feature-plans/plugin-system.md lines 2082-2133 for full design
        let pluginModule: any;

        if (modulePath.endsWith('.ts') || modulePath.endsWith('.tsx')) {
            // Use tsx for TypeScript files (development mode)
            // tsx is Node.js-only, so check environment first
            if (typeof process === 'undefined' || !process.versions?.node) {
                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_LOAD_FAILED,
                    ErrorScope.PLUGIN,
                    ErrorType.SYSTEM,
                    `Cannot load TypeScript plugin '${pluginName}' in browser environment. ` +
                        `Plugins with .ts extension require Node.js runtime.`,
                    { modulePath, pluginName }
                );
            }

            // Use computed string + webpackIgnore to prevent webpack from analyzing/bundling tsx
            // This tells webpack to skip this import during static analysis
            const tsxPackage = 'tsx/esm/api';
            const tsx = await import(/* webpackIgnore: true */ tsxPackage);
            pluginModule = await tsx.tsImport(modulePath, import.meta.url);
        } else {
            // Direct import for JavaScript files (production mode)
            pluginModule = await import(modulePath);
        }

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
