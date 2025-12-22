import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from './error-codes.js';
import { loadPluginModule, resolvePluginPath } from './loader.js';
import { getContext } from '../utils/async-context.js';
import { pluginRegistry, type PluginCreationContext } from './registry.js';
import type { RegistryPluginConfig } from './schemas.js';
import type {
    ExtensionPoint,
    PluginExecutionContext,
    PluginConfig,
    LoadedPlugin,
    PluginResult,
} from './types.js';
import type { AgentEventBus } from '../events/index.js';
import type { StorageManager } from '../storage/index.js';
import type { SessionManager } from '../session/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';

/**
 * Options for PluginManager construction
 */
export interface PluginManagerOptions {
    agentEventBus: AgentEventBus;
    storageManager: StorageManager;
    configDir: string;
}

/**
 * Options for building ExecutionContext
 * Used when calling executePlugins
 */
export interface ExecutionContextOptions {
    sessionManager: SessionManager;
    mcpManager: MCPManager;
    toolManager: ToolManager;
    stateManager: AgentStateManager;
    sessionId?: string;
    abortSignal?: AbortSignal;
}

/**
 * Plugin Manager - Orchestrates plugin loading and execution
 *
 * Responsibilities:
 * - Load plugins from configuration (built-in + custom)
 * - Validate plugin shape and priority uniqueness
 * - Manage plugin lifecycle (initialize, execute, cleanup)
 * - Execute plugins sequentially at extension points
 * - Handle timeouts and errors with fail-fast policy
 */
export class PluginManager {
    private plugins: Map<string, LoadedPlugin> = new Map();
    private pluginsByExtensionPoint: Map<ExtensionPoint, LoadedPlugin[]> = new Map();
    private options: PluginManagerOptions;
    private initialized: boolean = false;
    private logger: IDextoLogger;

    /** Default timeout for plugin execution (milliseconds) */
    private static readonly DEFAULT_TIMEOUT = 5000;

    constructor(options: PluginManagerOptions, logger: IDextoLogger) {
        this.options = options;
        this.logger = logger.createChild(DextoLogComponent.PLUGIN);
        this.logger.debug('PluginManager created');
    }

    /**
     * Register a built-in plugin
     * Called by the built-in plugin registry before initialize()
     *
     * @param name - Plugin name
     * @param PluginClass - Plugin class constructor
     * @param config - Plugin configuration
     */
    registerBuiltin(name: string, PluginClass: any, config: Omit<PluginConfig, 'module'>): void {
        if (this.initialized) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                'Cannot register built-in plugins after initialization'
            );
        }

        // Create plugin instance
        const plugin = new PluginClass();

        // Store as loaded plugin with synthetic module path
        const loadedPlugin: LoadedPlugin = {
            plugin,
            config: {
                name,
                module: `<builtin:${name}>`,
                enabled: config.enabled ?? true,
                blocking: config.blocking,
                priority: config.priority,
                config: config.config ?? undefined,
            },
        };

        this.plugins.set(name, loadedPlugin);
        this.logger.debug(`Built-in plugin registered: ${name}`);
    }

    /**
     * Initialize all plugins from configuration
     * Loads custom plugins (file-based), registry plugins (programmatic), validates priorities,
     * sorts by priority, and calls initialize()
     *
     * TODO: Consider adding an MCP server-like convention for plugin discovery.
     * Instead of requiring explicit file paths, plugins could be connected as
     * plugin servers to the PluginManager.
     *
     * @param customPlugins - Array of custom plugin configurations from YAML (file-based)
     * @param registryPlugins - Array of registry plugin configurations from YAML (programmatic)
     * @throws {DextoRuntimeError} If any plugin fails to load or initialize (fail-fast)
     */
    async initialize(
        customPlugins: PluginConfig[] = [],
        registryPlugins: RegistryPluginConfig[] = []
    ): Promise<void> {
        if (this.initialized) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                'PluginManager already initialized'
            );
        }

        // 1. Validate priority uniqueness across all plugins (built-in + custom + registry)
        const priorities = new Set<number>();
        const allPluginConfigs = [
            ...Array.from(this.plugins.values()).map((p) => p.config),
            ...customPlugins,
            ...registryPlugins.map((r) => ({
                name: r.type,
                module: `<registry:${r.type}>`,
                enabled: r.enabled,
                blocking: r.blocking,
                priority: r.priority,
                config: r.config,
            })),
        ];

        for (const config of allPluginConfigs) {
            if (!config.enabled) continue;

            if (priorities.has(config.priority)) {
                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_DUPLICATE_PRIORITY,
                    ErrorScope.PLUGIN,
                    ErrorType.USER,
                    `Duplicate plugin priority: ${config.priority}. Each plugin must have a unique priority.`,
                    {
                        priority: config.priority,
                        hint: 'Ensure all enabled plugins (built-in, custom, and registry) have unique priority values.',
                    }
                );
            }
            priorities.add(config.priority);
        }

        // 2. Load registry plugins first (they're programmatically registered)
        for (const registryConfig of registryPlugins) {
            if (!registryConfig.enabled) {
                this.logger.debug(`Skipping disabled registry plugin: ${registryConfig.type}`);
                continue;
            }

            try {
                // Get the provider from registry
                const provider = pluginRegistry.get(registryConfig.type);
                if (!provider) {
                    throw new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_PROVIDER_NOT_FOUND,
                        ErrorScope.PLUGIN,
                        ErrorType.USER,
                        `Plugin provider '${registryConfig.type}' not found in registry`,
                        {
                            type: registryConfig.type,
                            available: pluginRegistry.getTypes(),
                        },
                        `Available plugin providers: ${pluginRegistry.getTypes().join(', ') || 'none'}. Register the provider using pluginRegistry.register() before agent initialization.`
                    );
                }

                // Validate config against provider schema
                const validatedConfig = provider.configSchema.safeParse({
                    type: registryConfig.type,
                    ...registryConfig.config,
                });

                if (!validatedConfig.success) {
                    throw new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_PROVIDER_VALIDATION_FAILED,
                        ErrorScope.PLUGIN,
                        ErrorType.USER,
                        `Invalid configuration for plugin provider '${registryConfig.type}'`,
                        {
                            type: registryConfig.type,
                            errors: validatedConfig.error.errors,
                        },
                        'Check the configuration schema for this plugin provider'
                    );
                }

                // Create plugin instance
                const creationContext: PluginCreationContext = {
                    config: registryConfig.config || {},
                    blocking: registryConfig.blocking,
                    priority: registryConfig.priority,
                };

                const plugin = provider.create(validatedConfig.data, creationContext);

                // Store as loaded plugin
                const loadedPlugin: LoadedPlugin = {
                    plugin,
                    config: {
                        name: registryConfig.type,
                        module: `<registry:${registryConfig.type}>`,
                        enabled: registryConfig.enabled,
                        blocking: registryConfig.blocking,
                        priority: registryConfig.priority,
                        config: registryConfig.config,
                    },
                };
                this.plugins.set(registryConfig.type, loadedPlugin);

                this.logger.info(`Registry plugin loaded: ${registryConfig.type}`);
            } catch (error) {
                // Re-throw our own errors
                if (error instanceof DextoRuntimeError) {
                    throw error;
                }

                // Wrap other errors
                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_INITIALIZATION_FAILED,
                    ErrorScope.PLUGIN,
                    ErrorType.SYSTEM,
                    `Failed to load registry plugin '${registryConfig.type}': ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        // 3. Load custom plugins from config (file-based)
        for (const pluginConfig of customPlugins) {
            if (!pluginConfig.enabled) {
                this.logger.debug(`Skipping disabled plugin: ${pluginConfig.name}`);
                continue;
            }

            try {
                // Resolve and validate path
                const modulePath = resolvePluginPath(pluginConfig.module, this.options.configDir);

                // Load plugin module
                const PluginClass = await loadPluginModule(modulePath, pluginConfig.name);

                // Instantiate
                const plugin = new PluginClass();

                // Store
                const loadedPlugin: LoadedPlugin = {
                    plugin,
                    config: pluginConfig,
                };
                this.plugins.set(pluginConfig.name, loadedPlugin);

                this.logger.info(`Custom plugin loaded: ${pluginConfig.name}`);
            } catch (error) {
                // Fail fast - cannot run with broken plugins
                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_INITIALIZATION_FAILED,
                    ErrorScope.PLUGIN,
                    ErrorType.SYSTEM,
                    `Failed to load plugin '${pluginConfig.name}': ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        // 3. Initialize all plugins (call their initialize() method if exists)
        for (const [name, loadedPlugin] of this.plugins.entries()) {
            if (!loadedPlugin.config.enabled) continue;

            try {
                if (loadedPlugin.plugin.initialize) {
                    await loadedPlugin.plugin.initialize(loadedPlugin.config.config || {});
                    this.logger.debug(`Plugin initialized: ${name}`);
                }
            } catch (error) {
                // Fail fast - plugin initialization failure is critical
                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_INITIALIZATION_FAILED,
                    ErrorScope.PLUGIN,
                    ErrorType.SYSTEM,
                    `Plugin '${name}' initialization failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        // 4. Register plugins to their extension points
        for (const loadedPlugin of this.plugins.values()) {
            if (!loadedPlugin.config.enabled) continue;
            this.registerToExtensionPoints(loadedPlugin);
        }

        // 5. Sort plugins by priority for each extension point (low to high)
        for (const [extensionPoint, plugins] of this.pluginsByExtensionPoint.entries()) {
            plugins.sort((a, b) => a.config.priority - b.config.priority);
            this.logger.debug(
                `Extension point '${extensionPoint}': ${plugins.length} plugin(s) registered`,
                {
                    plugins: plugins.map((p) => ({
                        name: p.config.name,
                        priority: p.config.priority,
                    })),
                }
            );
        }

        this.initialized = true;
        this.logger.info(`PluginManager initialized with ${this.plugins.size} plugin(s)`);
    }

    /**
     * Register a plugin to the extension points it implements
     */
    private registerToExtensionPoints(loadedPlugin: LoadedPlugin): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        for (const point of extensionPoints) {
            if (typeof loadedPlugin.plugin[point] === 'function') {
                if (!this.pluginsByExtensionPoint.has(point)) {
                    this.pluginsByExtensionPoint.set(point, []);
                }
                this.pluginsByExtensionPoint.get(point)!.push(loadedPlugin);
            }
        }
    }

    /**
     * Execute all plugins at a specific extension point
     * Plugins execute sequentially in priority order
     *
     * @param extensionPoint - Which extension point to execute
     * @param payload - Payload for this extension point (must be an object)
     * @param options - Options for building execution context
     * @returns Modified payload after all plugins execute
     * @throws {DextoRuntimeError} If a blocking plugin cancels execution or payload is not an object
     */
    async executePlugins<T extends Record<string, any>>(
        extensionPoint: ExtensionPoint,
        payload: T,
        options: ExecutionContextOptions
    ): Promise<T> {
        const plugins = this.pluginsByExtensionPoint.get(extensionPoint) || [];
        if (plugins.length === 0) {
            return payload; // No plugins for this extension point
        }

        // Defensive runtime check: payload must be an object for spread operator
        if (payload === null || typeof payload !== 'object') {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_INVALID_SHAPE,
                ErrorScope.PLUGIN,
                ErrorType.USER,
                `Payload for ${extensionPoint} must be an object (got ${payload === null ? 'null' : typeof payload})`,
                { extensionPoint, payloadType: typeof payload }
            );
        }

        let currentPayload: T = { ...payload };

        // Build execution context
        const asyncCtx = getContext();
        const llmConfig = options.stateManager.getLLMConfig(options.sessionId);

        const context: PluginExecutionContext = {
            sessionId: options.sessionId ?? undefined,
            userId: asyncCtx?.userId ?? undefined,
            tenantId: asyncCtx?.tenantId ?? undefined,
            llmConfig,
            logger: this.logger,
            abortSignal: options.abortSignal ?? undefined,
            agent: {
                sessionManager: options.sessionManager,
                mcpManager: options.mcpManager,
                toolManager: options.toolManager,
                stateManager: options.stateManager,
                agentEventBus: this.options.agentEventBus,
                storageManager: this.options.storageManager,
            },
        };

        // Execute plugins sequentially
        for (const { plugin, config } of plugins) {
            const method = plugin[extensionPoint];
            if (!method) continue; // Shouldn't happen, but be safe

            const startTime = Date.now();

            try {
                // Execute with timeout
                // Use type assertion since we validated the method exists and has correct signature
                const result = await this.executeWithTimeout<PluginResult>(
                    (method as any).call(plugin, currentPayload, context),
                    config.name,
                    PluginManager.DEFAULT_TIMEOUT
                );

                const duration = Date.now() - startTime;

                // Log execution
                this.logger.debug(`Plugin '${config.name}' executed at ${extensionPoint}`, {
                    ok: result.ok,
                    cancelled: result.cancel,
                    duration,
                    hasModifications: !!result.modify,
                });

                // Emit notices if any
                if (result.notices && result.notices.length > 0) {
                    for (const notice of result.notices) {
                        const level =
                            notice.kind === 'block' || notice.kind === 'warn' ? 'warn' : 'info';
                        this.logger[level](`Plugin notice (${notice.kind}): ${notice.message}`, {
                            plugin: config.name,
                            code: notice.code,
                            details: notice.details,
                        });
                    }
                }

                // Handle failure
                if (!result.ok) {
                    this.logger.warn(`Plugin '${config.name}' returned error`, {
                        message: result.message,
                    });

                    if (config.blocking && result.cancel) {
                        // Blocking plugin wants to stop execution
                        throw new DextoRuntimeError(
                            PluginErrorCode.PLUGIN_BLOCKED_EXECUTION,
                            ErrorScope.PLUGIN,
                            ErrorType.FORBIDDEN,
                            result.message || `Operation blocked by plugin '${config.name}'`,
                            {
                                plugin: config.name,
                                extensionPoint,
                                notices: result.notices,
                            }
                        );
                    }

                    // Non-blocking: continue to next plugin
                    continue;
                }

                // Apply modifications
                if (result.modify) {
                    currentPayload = { ...currentPayload, ...result.modify };
                    this.logger.debug(`Plugin '${config.name}' modified payload`, {
                        keys: Object.keys(result.modify),
                    });
                }

                // Check cancellation
                if (result.cancel && config.blocking) {
                    throw new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_BLOCKED_EXECUTION,
                        ErrorScope.PLUGIN,
                        ErrorType.FORBIDDEN,
                        result.message || `Operation cancelled by plugin '${config.name}'`,
                        {
                            plugin: config.name,
                            extensionPoint,
                            notices: result.notices,
                        }
                    );
                }
            } catch (error) {
                const duration = Date.now() - startTime;

                // Re-throw our own errors
                if (error instanceof DextoRuntimeError) {
                    throw error;
                }

                // Plugin threw exception
                this.logger.error(`Plugin '${config.name}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                    duration,
                });

                if (config.blocking) {
                    // Blocking plugin failed - stop execution
                    throw new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_EXECUTION_FAILED,
                        ErrorScope.PLUGIN,
                        ErrorType.SYSTEM,
                        `Plugin '${config.name}' failed: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                        {
                            plugin: config.name,
                            extensionPoint,
                        }
                    );
                }

                // Non-blocking: continue
                this.logger.debug(`Non-blocking plugin error, continuing execution`);
            }
        }

        return currentPayload;
    }

    /**
     * Execute a promise with timeout, properly clearing timer on completion
     * Prevents timer leaks and unhandled rejections from Promise.race
     */
    private async executeWithTimeout<T>(
        promise: Promise<T>,
        pluginName: string,
        ms: number
    ): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        return await new Promise<T>((resolve, reject) => {
            timer = setTimeout(() => {
                reject(
                    new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_EXECUTION_TIMEOUT,
                        ErrorScope.PLUGIN,
                        ErrorType.TIMEOUT,
                        `Plugin '${pluginName}' execution timed out after ${ms}ms`
                    )
                );
            }, ms);
            promise.then(
                (val) => {
                    if (timer) clearTimeout(timer);
                    resolve(val);
                },
                (err) => {
                    if (timer) clearTimeout(timer);
                    reject(err);
                }
            );
        });
    }

    /**
     * Cleanup all plugins
     * Called when agent shuts down
     */
    async cleanup(): Promise<void> {
        for (const [name, loadedPlugin] of this.plugins.entries()) {
            if (loadedPlugin.plugin.cleanup) {
                try {
                    await loadedPlugin.plugin.cleanup();
                    this.logger.debug(`Plugin cleaned up: ${name}`);
                } catch (error) {
                    this.logger.error(`Plugin cleanup failed: ${name}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        this.logger.info('PluginManager cleanup complete');
    }

    /**
     * Get plugin statistics
     */
    getStats(): {
        total: number;
        enabled: number;
        byExtensionPoint: Record<ExtensionPoint, number>;
    } {
        const enabled = Array.from(this.plugins.values()).filter((p) => p.config.enabled).length;

        const byExtensionPoint: Record<string, number> = {};
        for (const [point, plugins] of this.pluginsByExtensionPoint.entries()) {
            byExtensionPoint[point] = plugins.length;
        }

        return {
            total: this.plugins.size,
            enabled,
            byExtensionPoint: byExtensionPoint as Record<ExtensionPoint, number>,
        };
    }
}
