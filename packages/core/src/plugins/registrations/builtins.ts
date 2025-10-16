import type { PluginManager } from '../manager.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';

/**
 * Register all built-in plugins with the PluginManager
 * Called during agent initialization before custom plugins are loaded
 *
 * Built-in plugins are referenced by name in the config (e.g., contentPolicy, responseSanitizer)
 * and activated based on presence of their configuration object.
 *
 * TODO: Implement ContentPolicy plugin (from feat/hooks content-policy)
 * TODO: Implement ResponseSanitizer plugin (from feat/hooks response-sanitizer)
 *
 * @param pluginManager - The PluginManager instance
 * @param config - Validated agent configuration
 */
export function registerBuiltInPlugins(_args: {
    pluginManager: PluginManager;
    config: ValidatedAgentConfig;
}): void {
    // TODO: Implement built-in plugins
    // For now, this is a stub that will be filled in during a follow-up task
    //
    // Example of what this will look like:
    //
    // const cp = args.config.plugins?.contentPolicy;
    // if (cp && typeof cp === 'object') {
    //     args.pluginManager.registerBuiltin(
    //         'content-policy',
    //         ContentPolicyPlugin,
    //         {
    //             priority: cp.priority,
    //             blocking: cp.blocking ?? true,
    //             config: cp
    //         }
    //     );
    // }
    //
    // const rs = args.config.plugins?.responseSanitizer;
    // if (rs && typeof rs === 'object') {
    //     args.pluginManager.registerBuiltin(
    //         'response-sanitizer',
    //         ResponseSanitizerPlugin,
    //         {
    //             priority: rs.priority,
    //             blocking: rs.blocking ?? false,
    //             config: rs
    //         }
    //     );
    // }
}
