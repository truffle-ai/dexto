import type { Logger } from '@dexto/core';
import type { ToolStateStore } from '@dexto/core/storage';
import { SchedulerToolsConfigSchema, type SchedulerToolsConfig } from './schemas.js';
import type { ScheduleExecutorFn } from './types.js';
import { SchedulerManager } from './manager.js';

/**
 * Options for constructing a scheduler service.
 *
 * @property toolStateStore Store used for scheduler persistence.
 * @property logger Logger used by the scheduler manager.
 * @property config Optional scheduler config. Defaults to `SchedulerToolsConfigSchema` when omitted.
 * @property storageNamespace Optional namespace for scheduler storage.
 * @property executor Optional executor override for schedule runs.
 * @property autoStart When false, initializes without starting the scheduler.
 */
export type SchedulerServiceOptions = {
    toolStateStore: ToolStateStore;
    logger: Logger;
    config?: SchedulerToolsConfig;
    storageNamespace?: string;
    executor?: ScheduleExecutorFn;
    autoStart?: boolean;
};

/**
 * Create and initialize a SchedulerManager with optional overrides.
 *
 * If `config` is omitted, this uses `SchedulerToolsConfigSchema` to provide defaults.
 * Use `executor` to override how scheduled tasks are executed without changing storage or config.
 *
 * @param options Service construction options.
 *
 * @returns A ready-to-use SchedulerManager instance.
 */
export async function createSchedulerService(
    options: SchedulerServiceOptions
): Promise<SchedulerManager> {
    const resolvedConfig =
        options.config ?? SchedulerToolsConfigSchema.parse({ type: 'scheduler-tools' });
    const manager = new SchedulerManager(
        options.toolStateStore,
        resolvedConfig,
        options.logger,
        options.storageNamespace ? { storageNamespace: options.storageNamespace } : undefined
    );

    if (options.executor) {
        manager.setExecutor(options.executor);
    }

    await manager.init();
    if (options.autoStart !== false) {
        try {
            await manager.start();
        } catch (error) {
            await manager.stop().catch(() => undefined);
            throw error;
        }
    }

    return manager;
}
