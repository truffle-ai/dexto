import type { PluginManager } from '../manager.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';
import { ContentPolicyPlugin } from '../builtins/content-policy.js';
import { ResponseSanitizerPlugin } from '../builtins/response-sanitizer.js';

/**
 * Register all built-in plugins with the PluginManager
 * Called during agent initialization before custom plugins are loaded
 *
 * Built-in plugins are referenced by name in the config (e.g., contentPolicy, responseSanitizer)
 * and activated based on presence of their configuration object.
 *
 * @param pluginManager - The PluginManager instance
 * @param config - Validated agent configuration
 */
export function registerBuiltInPlugins(args: {
    pluginManager: PluginManager;
    config: ValidatedAgentConfig;
}): void {
    // Register ContentPolicy plugin if configured
    const cp = args.config.plugins?.contentPolicy;
    if (cp && typeof cp === 'object' && cp.enabled !== false) {
        args.pluginManager.registerBuiltin('content-policy', ContentPolicyPlugin, {
            name: 'content-policy',
            enabled: cp.enabled ?? true,
            priority: cp.priority,
            blocking: cp.blocking ?? true,
            config: cp,
        });
    }

    // Register ResponseSanitizer plugin if configured
    const rs = args.config.plugins?.responseSanitizer;
    if (rs && typeof rs === 'object' && rs.enabled !== false) {
        args.pluginManager.registerBuiltin('response-sanitizer', ResponseSanitizerPlugin, {
            name: 'response-sanitizer',
            enabled: rs.enabled ?? true,
            priority: rs.priority,
            blocking: rs.blocking ?? false,
            config: rs,
        });
    }
}
