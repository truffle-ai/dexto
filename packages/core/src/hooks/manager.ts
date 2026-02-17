import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { HookErrorCode } from './error-codes.js';
import { getContext } from '../utils/async-context.js';
import type { ExtensionPoint, HookExecutionContext, Hook, HookResult } from './types.js';
import type { AgentEventBus } from '../events/index.js';
import type { StorageManager } from '../storage/index.js';
import type { SessionManager } from '../session/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';

/**
 * Options for HookManager construction.
 */
export interface HookManagerOptions {
    agentEventBus: AgentEventBus;
    storageManager: StorageManager;
}

/**
 * Options for building hook execution context.
 * Used when calling `executeHooks()`.
 */
export interface HookExecutionContextOptions {
    sessionManager: SessionManager;
    mcpManager: MCPManager;
    toolManager: ToolManager;
    stateManager: AgentStateManager;
    sessionId?: string;
    abortSignal?: AbortSignal;
}

/**
 * Hook Manager - Orchestrates hook execution.
 *
 * Responsibilities:
 * - Validate hook shape
 * - Manage hook lifecycle (initialize, execute, cleanup)
 * - Execute hooks sequentially at extension points
 * - Handle timeouts and errors with fail-fast policy
 */
export class HookManager {
    private hooks: Hook[] = [];
    private hooksByExtensionPoint: Map<ExtensionPoint, Hook[]> = new Map();
    private hookNameByInstance: WeakMap<Hook, string> = new WeakMap();
    private options: HookManagerOptions;
    private initialized: boolean = false;
    private logger: Logger;

    /** Default timeout for hook execution (milliseconds) */
    private static readonly DEFAULT_TIMEOUT = 5000;

    constructor(options: HookManagerOptions, hooks: Hook[], logger: Logger) {
        this.options = options;
        this.logger = logger.createChild(DextoLogComponent.HOOK);
        this.setHooks(hooks);
        this.logger.debug('HookManager created');
    }

    /**
     * Provide the concrete hooks this manager should orchestrate.
     * Hooks must be fully resolved and initialized before calling `initialize()`.
     */
    setHooks(hooks: Hook[]): void {
        if (this.initialized) {
            throw new DextoRuntimeError(
                HookErrorCode.HOOK_CONFIGURATION_INVALID,
                ErrorScope.HOOK,
                ErrorType.SYSTEM,
                'Cannot set hooks after initialization'
            );
        }

        this.hooks = [...hooks];
        this.hooksByExtensionPoint.clear();
        this.hookNameByInstance = new WeakMap();
        for (const [index, hook] of this.hooks.entries()) {
            this.hookNameByInstance.set(hook, this.deriveHookName(hook, index));
        }
    }

    /**
     * Initialize hook orchestration.
     * Validates hook shapes and registers them to extension points.
     * @throws {DextoRuntimeError} If any hook fails validation (fail-fast)
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new DextoRuntimeError(
                HookErrorCode.HOOK_CONFIGURATION_INVALID,
                ErrorScope.HOOK,
                ErrorType.SYSTEM,
                'HookManager already initialized'
            );
        }

        // Validate hook shapes and register to extension points
        for (const [index, hook] of this.hooks.entries()) {
            this.assertValidHookShape(hook, index);
            this.registerToExtensionPoints(hook);
        }

        for (const [extensionPoint, hooks] of this.hooksByExtensionPoint.entries()) {
            this.logger.debug(
                `Extension point '${extensionPoint}': ${hooks.length} hook(s) registered`
            );
        }

        this.initialized = true;
        this.logger.info(`HookManager initialized with ${this.hooks.length} hook(s)`);
    }

    /**
     * Register a hook to the extension points it implements.
     */
    private registerToExtensionPoints(hook: Hook): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        for (const point of extensionPoints) {
            if (typeof hook[point] === 'function') {
                if (!this.hooksByExtensionPoint.has(point)) {
                    this.hooksByExtensionPoint.set(point, []);
                }
                this.hooksByExtensionPoint.get(point)!.push(hook);
            }
        }
    }

    /**
     * Execute all hooks at a specific extension point.
     * Hooks execute sequentially in the order they were provided.
     *
     * @param extensionPoint - Which extension point to execute
     * @param payload - Payload for this extension point (must be an object)
     * @param options - Options for building execution context
     * @returns Modified payload after all hooks execute
     * @throws {DextoRuntimeError} If a hook cancels execution or payload is not an object
     */
    async executeHooks<T extends object>(
        extensionPoint: ExtensionPoint,
        payload: T,
        options: HookExecutionContextOptions
    ): Promise<T> {
        const hooks = this.hooksByExtensionPoint.get(extensionPoint) || [];
        if (hooks.length === 0) {
            return payload; // No hooks for this extension point
        }

        // Defensive runtime check: payload must be an object for spread operator
        if (payload === null || typeof payload !== 'object') {
            throw new DextoRuntimeError(
                HookErrorCode.HOOK_INVALID_SHAPE,
                ErrorScope.HOOK,
                ErrorType.USER,
                `Payload for ${extensionPoint} must be an object (got ${payload === null ? 'null' : typeof payload})`,
                { extensionPoint, payloadType: typeof payload }
            );
        }

        let currentPayload = { ...(payload as Record<string, unknown>) } as T;

        // Build execution context
        const asyncCtx = getContext();
        const llmConfig = options.stateManager.getLLMConfig(options.sessionId);

        const context: HookExecutionContext = {
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

        // Execute hooks sequentially
        for (const [index, hook] of hooks.entries()) {
            const method = hook[extensionPoint];
            if (!method) continue; // Shouldn't happen, but be safe

            const hookName = this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
            const startTime = Date.now();

            try {
                // Execute with timeout
                // Use type assertion since we validated the method exists and has correct signature
                const result = await this.executeWithTimeout<HookResult>(
                    (
                        method as unknown as (
                            payload: T,
                            context: HookExecutionContext
                        ) => Promise<HookResult>
                    ).call(hook, currentPayload, context),
                    hookName,
                    HookManager.DEFAULT_TIMEOUT
                );

                const duration = Date.now() - startTime;

                // Log execution
                this.logger.debug(`Hook '${hookName}' executed at ${extensionPoint}`, {
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
                        this.logger[level](`Hook notice (${notice.kind}): ${notice.message}`, {
                            hook: hookName,
                            code: notice.code,
                            details: notice.details,
                        });
                    }
                }

                // Handle failure
                if (!result.ok) {
                    this.logger.warn(`Hook '${hookName}' returned error`, {
                        message: result.message,
                    });

                    if (result.cancel) {
                        throw new DextoRuntimeError(
                            HookErrorCode.HOOK_BLOCKED_EXECUTION,
                            ErrorScope.HOOK,
                            ErrorType.FORBIDDEN,
                            result.message || `Operation blocked by hook '${hookName}'`,
                            {
                                hook: hookName,
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
                    this.logger.debug(`Hook '${hookName}' modified payload`, {
                        keys: Object.keys(result.modify),
                    });
                }

                // Check cancellation
                if (result.cancel) {
                    throw new DextoRuntimeError(
                        HookErrorCode.HOOK_BLOCKED_EXECUTION,
                        ErrorScope.HOOK,
                        ErrorType.FORBIDDEN,
                        result.message || `Operation cancelled by hook '${hookName}'`,
                        {
                            hook: hookName,
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

                // Hook threw exception
                this.logger.error(`Hook '${hookName}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                    duration,
                });

                throw new DextoRuntimeError(
                    HookErrorCode.HOOK_EXECUTION_FAILED,
                    ErrorScope.HOOK,
                    ErrorType.SYSTEM,
                    `Hook '${hookName}' failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    {
                        hook: hookName,
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
        hookName: string,
        ms: number
    ): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        return await new Promise<T>((resolve, reject) => {
            timer = setTimeout(() => {
                reject(
                    new DextoRuntimeError(
                        HookErrorCode.HOOK_EXECUTION_TIMEOUT,
                        ErrorScope.HOOK,
                        ErrorType.TIMEOUT,
                        `Hook '${hookName}' execution timed out after ${ms}ms`
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
     * Cleanup all hooks.
     * Called when agent shuts down
     */
    async cleanup(): Promise<void> {
        for (const [index, hook] of this.hooks.entries()) {
            const hookName = this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
            if (hook.cleanup) {
                try {
                    await hook.cleanup();
                    this.logger.debug(`Hook cleaned up: ${hookName}`);
                } catch (error) {
                    this.logger.error(`Hook cleanup failed: ${hookName}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        this.logger.info('HookManager cleanup complete');
    }

    /**
     * Get hook statistics.
     */
    getStats(): {
        total: number;
        enabled: number;
        byExtensionPoint: Record<ExtensionPoint, number>;
    } {
        const byExtensionPoint: Record<string, number> = {};
        for (const [point, hooks] of this.hooksByExtensionPoint.entries()) {
            byExtensionPoint[point] = hooks.length;
        }

        return {
            total: this.hooks.length,
            enabled: this.hooks.length,
            byExtensionPoint: byExtensionPoint as Record<ExtensionPoint, number>,
        };
    }

    /**
     * List configured hook names in registration order.
     */
    listHookNames(): string[] {
        return this.hooks.map((hook, index) => {
            return this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
        });
    }

    private deriveHookName(hook: Hook, index: number): string {
        const maybeNamed = hook as unknown as { name?: unknown };
        if (typeof maybeNamed.name === 'string' && maybeNamed.name.trim().length > 0) {
            return maybeNamed.name;
        }

        const ctorName = (hook as { constructor?: { name?: unknown } }).constructor?.name;
        if (typeof ctorName === 'string' && ctorName !== 'Object' && ctorName.trim().length > 0) {
            return ctorName;
        }

        return `hook#${index + 1}`;
    }

    private assertValidHookShape(hook: Hook, index: number): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        const hasExtensionPoint = extensionPoints.some(
            (point) => typeof hook[point] === 'function'
        );

        if (!hasExtensionPoint) {
            throw new DextoRuntimeError(
                HookErrorCode.HOOK_INVALID_SHAPE,
                ErrorScope.HOOK,
                ErrorType.USER,
                `Hook '${this.deriveHookName(hook, index)}' must implement at least one extension point method`,
                { availableExtensionPoints: extensionPoints }
            );
        }
    }
}
