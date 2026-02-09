import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from './error-codes.js';
import { getContext } from '../utils/async-context.js';
import type { ExtensionPoint, PluginExecutionContext, DextoPlugin, PluginResult } from './types.js';
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
 * - Validate plugin shape
 * - Manage plugin lifecycle (initialize, execute, cleanup)
 * - Execute plugins sequentially at extension points
 * - Handle timeouts and errors with fail-fast policy
 */
export class PluginManager {
    private plugins: DextoPlugin[] = [];
    private pluginsByExtensionPoint: Map<ExtensionPoint, DextoPlugin[]> = new Map();
    private pluginNameByInstance: WeakMap<DextoPlugin, string> = new WeakMap();
    private options: PluginManagerOptions;
    private initialized: boolean = false;
    private logger: IDextoLogger;

    /** Default timeout for plugin execution (milliseconds) */
    private static readonly DEFAULT_TIMEOUT = 5000;

    constructor(options: PluginManagerOptions, plugins: DextoPlugin[], logger: IDextoLogger) {
        this.options = options;
        this.logger = logger.createChild(DextoLogComponent.PLUGIN);
        this.setPlugins(plugins);
        this.logger.debug('PluginManager created');
    }

    /**
     * Provide the concrete plugins this manager should orchestrate.
     * Plugins must be fully resolved and initialized before calling `initialize()`.
     */
    setPlugins(plugins: DextoPlugin[]): void {
        if (this.initialized) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                'Cannot set plugins after initialization'
            );
        }

        this.plugins = [...plugins];
        this.pluginsByExtensionPoint.clear();
        this.pluginNameByInstance = new WeakMap();
        for (const [index, plugin] of this.plugins.entries()) {
            this.pluginNameByInstance.set(plugin, this.derivePluginName(plugin, index));
        }
    }

    /**
     * Initialize plugin orchestration.
     * Validates plugin shapes and registers them to extension points.
     * @throws {DextoRuntimeError} If any plugin fails validation (fail-fast)
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_CONFIGURATION_INVALID,
                ErrorScope.PLUGIN,
                ErrorType.SYSTEM,
                'PluginManager already initialized'
            );
        }

        // Validate plugin shapes and register to extension points
        for (const [index, plugin] of this.plugins.entries()) {
            this.assertValidPluginShape(plugin, index);
            this.registerToExtensionPoints(plugin);
        }

        for (const [extensionPoint, plugins] of this.pluginsByExtensionPoint.entries()) {
            this.logger.debug(
                `Extension point '${extensionPoint}': ${plugins.length} plugin(s) registered`
            );
        }

        this.initialized = true;
        this.logger.info(`PluginManager initialized with ${this.plugins.length} plugin(s)`);
    }

    /**
     * Register a plugin to the extension points it implements
     */
    private registerToExtensionPoints(plugin: DextoPlugin): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        for (const point of extensionPoints) {
            if (typeof plugin[point] === 'function') {
                if (!this.pluginsByExtensionPoint.has(point)) {
                    this.pluginsByExtensionPoint.set(point, []);
                }
                this.pluginsByExtensionPoint.get(point)!.push(plugin);
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
    async executePlugins<T extends object>(
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

        let currentPayload = { ...(payload as Record<string, unknown>) } as T;

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
        for (const [index, plugin] of plugins.entries()) {
            const method = plugin[extensionPoint];
            if (!method) continue; // Shouldn't happen, but be safe

            const pluginName =
                this.pluginNameByInstance.get(plugin) ?? this.derivePluginName(plugin, index);
            const startTime = Date.now();

            try {
                // Execute with timeout
                // Use type assertion since we validated the method exists and has correct signature
                const result = await this.executeWithTimeout<PluginResult>(
                    (
                        method as unknown as (
                            payload: T,
                            context: PluginExecutionContext
                        ) => Promise<PluginResult>
                    ).call(plugin, currentPayload, context),
                    pluginName,
                    PluginManager.DEFAULT_TIMEOUT
                );

                const duration = Date.now() - startTime;

                // Log execution
                this.logger.debug(`Plugin '${pluginName}' executed at ${extensionPoint}`, {
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
                            plugin: pluginName,
                            code: notice.code,
                            details: notice.details,
                        });
                    }
                }

                // Handle failure
                if (!result.ok) {
                    this.logger.warn(`Plugin '${pluginName}' returned error`, {
                        message: result.message,
                    });

                    if (result.cancel) {
                        throw new DextoRuntimeError(
                            PluginErrorCode.PLUGIN_BLOCKED_EXECUTION,
                            ErrorScope.PLUGIN,
                            ErrorType.FORBIDDEN,
                            result.message || `Operation blocked by plugin '${pluginName}'`,
                            {
                                plugin: pluginName,
                                extensionPoint,
                                notices: result.notices,
                            }
                        );
                    }

                    continue;
                }

                // Apply modifications
                if (result.modify) {
                    currentPayload = {
                        ...(currentPayload as Record<string, unknown>),
                        ...result.modify,
                    } as T;
                    this.logger.debug(`Plugin '${pluginName}' modified payload`, {
                        keys: Object.keys(result.modify),
                    });
                }

                // Check cancellation
                if (result.cancel) {
                    throw new DextoRuntimeError(
                        PluginErrorCode.PLUGIN_BLOCKED_EXECUTION,
                        ErrorScope.PLUGIN,
                        ErrorType.FORBIDDEN,
                        result.message || `Operation cancelled by plugin '${pluginName}'`,
                        {
                            plugin: pluginName,
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
                this.logger.error(`Plugin '${pluginName}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                    duration,
                });

                throw new DextoRuntimeError(
                    PluginErrorCode.PLUGIN_EXECUTION_FAILED,
                    ErrorScope.PLUGIN,
                    ErrorType.SYSTEM,
                    `Plugin '${pluginName}' failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    {
                        plugin: pluginName,
                        extensionPoint,
                    }
                );
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
        for (const [index, plugin] of this.plugins.entries()) {
            const pluginName =
                this.pluginNameByInstance.get(plugin) ?? this.derivePluginName(plugin, index);
            if (plugin.cleanup) {
                try {
                    await plugin.cleanup();
                    this.logger.debug(`Plugin cleaned up: ${pluginName}`);
                } catch (error) {
                    this.logger.error(`Plugin cleanup failed: ${pluginName}`, {
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
        const byExtensionPoint: Record<string, number> = {};
        for (const [point, plugins] of this.pluginsByExtensionPoint.entries()) {
            byExtensionPoint[point] = plugins.length;
        }

        return {
            total: this.plugins.length,
            enabled: this.plugins.length,
            byExtensionPoint: byExtensionPoint as Record<ExtensionPoint, number>,
        };
    }

    private derivePluginName(plugin: DextoPlugin, index: number): string {
        const maybeNamed = plugin as unknown as { name?: unknown };
        if (typeof maybeNamed.name === 'string' && maybeNamed.name.trim().length > 0) {
            return maybeNamed.name;
        }

        const ctorName = (plugin as { constructor?: { name?: unknown } }).constructor?.name;
        if (typeof ctorName === 'string' && ctorName !== 'Object' && ctorName.trim().length > 0) {
            return ctorName;
        }

        return `plugin#${index + 1}`;
    }

    private assertValidPluginShape(plugin: DextoPlugin, index: number): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        const hasExtensionPoint = extensionPoints.some(
            (point) => typeof plugin[point] === 'function'
        );

        if (!hasExtensionPoint) {
            throw new DextoRuntimeError(
                PluginErrorCode.PLUGIN_INVALID_SHAPE,
                ErrorScope.PLUGIN,
                ErrorType.USER,
                `Plugin '${this.derivePluginName(plugin, index)}' must implement at least one extension point method`,
                { availableExtensionPoints: extensionPoints }
            );
        }
    }
}
