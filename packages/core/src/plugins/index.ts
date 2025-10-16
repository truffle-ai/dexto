/**
 * Plugin System
 *
 * Unified plugin architecture for extending agent behavior at key extension points.
 * Replaces the hooks system from PR #385 with a more flexible plugin model.
 */

// Core types for plugin development
export type {
    DextoPlugin,
    PluginConfig,
    PluginExecutionContext,
    PluginResult,
    PluginNotice,
    ExtensionPoint,
    BeforeLLMRequestPayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    BeforeResponsePayload,
} from './types.js';

// Plugin manager for service integration
export { PluginManager } from './manager.js';
export type { PluginManagerOptions, ExecutionContextOptions } from './manager.js';

// Plugin configuration schemas
export {
    CustomPluginConfigSchema,
    BuiltInPluginConfigSchema,
    PluginsConfigSchema,
} from './schemas.js';
export type { PluginsConfig, ValidatedPluginsConfig } from './schemas.js';

// Error codes
export { PluginErrorCode } from './error-codes.js';

// Plugin utilities for advanced use cases
export { loadPluginModule, resolvePluginPath, validatePluginShape } from './loader.js';

// Built-in plugin registry (for extending with custom built-ins)
export { registerBuiltInPlugins } from './registrations/builtins.js';
