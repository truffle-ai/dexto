import type { Logger, StorageManager } from '@dexto/core';
import { SchedulerToolsConfigSchema, type SchedulerToolsConfig } from './schemas.js';
import type { ScheduleExecutorFn } from './types.js';
import { SchedulerManager } from './manager.js';

/**
 * Options for constructing a scheduler service.
 */
export type SchedulerServiceOptions = {
    storageManager: StorageManager;
    logger: Logger;
    config?: SchedulerToolsConfig;
    storageNamespace?: string;
    executor?: ScheduleExecutorFn;
    autoStart?: boolean;
};

/**
 * Create and initialize a SchedulerManager with optional overrides.
 *
 * @returns A ready-to-use SchedulerManager instance.
 */
export async function createSchedulerService(
    options: SchedulerServiceOptions
): Promise<SchedulerManager> {
    const resolvedConfig =
        options.config ?? SchedulerToolsConfigSchema.parse({ type: 'scheduler-tools' });
    const manager = new SchedulerManager(
        options.storageManager,
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
