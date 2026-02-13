/**
 * Plugin System
 *
 * Unified plugin architecture for extending agent behavior at key extension points.
 * Replaces the hooks system from PR #385 with a more flexible plugin model.
 */

// Core types for plugin development
export type {
    Plugin,
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

// Error codes
export { PluginErrorCode } from './error-codes.js';

// Built-in plugins
export { ContentPolicyPlugin } from './builtins/content-policy.js';
export type { ContentPolicyConfig } from './builtins/content-policy.js';
export { ResponseSanitizerPlugin } from './builtins/response-sanitizer.js';
export type { ResponseSanitizerConfig } from './builtins/response-sanitizer.js';
