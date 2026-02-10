import type { IDextoLogger } from '../logger/v2/types.js';
import type { AgentRuntimeConfig } from './runtime-config.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from '../plugins/error-codes.js';
import type { DextoPlugin, PluginExecutionContext, PluginResult } from '../plugins/types.js';
import { ContentPolicyPlugin } from '../plugins/builtins/content-policy.js';
import { ResponseSanitizerPlugin } from '../plugins/builtins/response-sanitizer.js';

// TODO: temporary glue code to be removed/verified
// During the DI refactor, plugin resolution will move out of core into `@dexto/agent-config`.

type BuiltInPluginConfig = {
    priority: number;
    enabled?: boolean;
    blocking?: boolean;
} & Record<string, unknown>;

function wrapPluginWithBlockingBehavior(options: {
    name: string;
    plugin: DextoPlugin;
    blocking: boolean;
    logger: IDextoLogger;
}): DextoPlugin & { name: string } {
    const { name, plugin, blocking, logger } = options;

    const coerceResult = (result: PluginResult): PluginResult => {
        if (blocking) {
            return result;
        }
        return {
            ...result,
            cancel: false,
        };
    };

    const wrap = <TPayload extends object>(
        fn: (payload: TPayload, context: PluginExecutionContext) => Promise<PluginResult>
    ) => {
        return async (
            payload: TPayload,
            context: PluginExecutionContext
        ): Promise<PluginResult> => {
            try {
                const result = await fn(payload, context);
                return coerceResult(result);
            } catch (error) {
                if (blocking) {
                    throw error;
                }

                logger.warn(`Non-blocking plugin '${name}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                });

                return {
                    ok: false,
                    cancel: false,
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        };
    };

    const wrapped: DextoPlugin & { name: string } = {
        name,
    };

    if (plugin.beforeLLMRequest) {
        wrapped.beforeLLMRequest = wrap(plugin.beforeLLMRequest.bind(plugin));
    }
    if (plugin.beforeToolCall) {
        wrapped.beforeToolCall = wrap(plugin.beforeToolCall.bind(plugin));
    }
    if (plugin.afterToolResult) {
        wrapped.afterToolResult = wrap(plugin.afterToolResult.bind(plugin));
    }
    if (plugin.beforeResponse) {
        wrapped.beforeResponse = wrap(plugin.beforeResponse.bind(plugin));
    }
    if (plugin.cleanup) {
        wrapped.cleanup = plugin.cleanup.bind(plugin);
    }

    return wrapped;
}

function coerceBuiltInPluginConfig(value: unknown, pluginName: string): BuiltInPluginConfig {
    if (value === null || typeof value !== 'object') {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Invalid configuration for built-in plugin '${pluginName}': expected an object`
        );
    }

    const config = value as Record<string, unknown>;
    const priority = config.priority;
    if (typeof priority !== 'number' || !Number.isInteger(priority)) {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Invalid configuration for built-in plugin '${pluginName}': 'priority' must be an integer`
        );
    }

    return config as BuiltInPluginConfig;
}

export async function resolveLocalPluginsFromConfig(options: {
    config: AgentRuntimeConfig;
    logger: IDextoLogger;
}): Promise<DextoPlugin[]> {
    const { config, logger } = options;

    if (config.plugins.custom.length > 0 || config.plugins.registry.length > 0) {
        throw new DextoRuntimeError(
            PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            'Custom/registry plugins are no longer supported in core. Use image-provided plugins instead.',
            {
                customCount: config.plugins.custom.length,
                registryCount: config.plugins.registry.length,
            }
        );
    }

    const resolved: Array<{ plugin: DextoPlugin; priority: number }> = [];
    const priorities = new Set<number>();

    const register = (args: {
        name: string;
        plugin: DextoPlugin;
        priority: number;
        blocking: boolean;
    }) => {
        if (priorities.has(args.priority)) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_DUPLICATE_PRIORITY,
                ErrorScope.PLUGIN,
                ErrorType.USER,
                `Duplicate plugin priority: ${args.priority}. Each plugin must have a unique priority.`,
                {
                    priority: args.priority,
                    hint: 'Ensure all enabled plugins have unique priority values.',
                }
            );
        }
        priorities.add(args.priority);

        resolved.push({
            plugin: wrapPluginWithBlockingBehavior({
                name: args.name,
                plugin: args.plugin,
                blocking: args.blocking,
                logger,
            }),
            priority: args.priority,
        });
    };

    const contentPolicyConfig = config.plugins.contentPolicy;
    if (contentPolicyConfig && (contentPolicyConfig as { enabled?: boolean }).enabled !== false) {
        const cfg = coerceBuiltInPluginConfig(contentPolicyConfig, 'content-policy');
        const plugin = new ContentPolicyPlugin();
        try {
            if (plugin.initialize) {
                await plugin.initialize(cfg);
            }
        } catch (error) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_INITIALIZATION_FAILED,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                `Built-in plugin 'content-policy' initialization failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        register({
            name: 'content-policy',
            plugin,
            priority: cfg.priority,
            blocking: cfg.blocking ?? true,
        });
    }

    const responseSanitizerConfig = config.plugins.responseSanitizer;
    if (
        responseSanitizerConfig &&
        (responseSanitizerConfig as { enabled?: boolean }).enabled !== false
    ) {
        const cfg = coerceBuiltInPluginConfig(responseSanitizerConfig, 'response-sanitizer');
        const plugin = new ResponseSanitizerPlugin();
        try {
            if (plugin.initialize) {
                await plugin.initialize(cfg);
            }
        } catch (error) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_INITIALIZATION_FAILED,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                `Built-in plugin 'response-sanitizer' initialization failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        register({
            name: 'response-sanitizer',
            plugin,
            priority: cfg.priority,
            blocking: cfg.blocking ?? false,
        });
    }

    resolved.sort((a, b) => a.priority - b.priority);
    return resolved.map((r) => r.plugin);
}
