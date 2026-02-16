/**
 * Storage layer for schedules and execution logs
 */

import type { StorageManager, Logger } from '@dexto/core';
import type { Schedule, ExecutionLog } from './types.js';
import { SchedulerError } from './errors.js';

const SCHEDULE_PREFIX = 'schedule:';
const EXECUTION_LOG_PREFIX = 'execution:';
const SCHEDULE_LIST_KEY = 'scheduler:schedules';

/**
 * Storage layer for scheduler persistence
 */
export class ScheduleStorage {
    constructor(
        private storageManager: StorageManager,
        private maxExecutionHistory: number,
        private logger: Logger
    ) {}

    /**
     * Save a schedule to persistent storage
     */
    async saveSchedule(schedule: Schedule): Promise<void> {
        try {
            const key = `${SCHEDULE_PREFIX}${schedule.id}`;
            await this.storageManager.getDatabase().set(key, schedule);

            // Maintain list of schedule IDs for efficient listing
            await this.addScheduleToList(schedule.id);

            this.logger.debug(`Schedule ${schedule.id} saved to storage`, { name: schedule.name });
        } catch (error) {
            throw SchedulerError.storageWriteFailed(
                'save schedule',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Load a schedule from storage
     */
    async loadSchedule(scheduleId: string): Promise<Schedule | null> {
        try {
            const key = `${SCHEDULE_PREFIX}${scheduleId}`;
            const schedule = await this.storageManager.getDatabase().get<Schedule>(key);
            return schedule || null;
        } catch (error) {
            throw SchedulerError.storageReadFailed(
                'load schedule',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * List all schedules from storage
     */
    async listSchedules(): Promise<Schedule[]> {
        try {
            // Get list of schedule IDs
            const scheduleIds =
                (await this.storageManager.getDatabase().get<string[]>(SCHEDULE_LIST_KEY)) || [];

            // Load all schedules
            const schedules: Schedule[] = [];
            for (const scheduleId of scheduleIds) {
                const schedule = await this.loadSchedule(scheduleId);
                if (schedule) {
                    schedules.push(schedule);
                }
            }

            return schedules;
        } catch (error) {
            throw SchedulerError.storageReadFailed(
                'list schedules',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Delete a schedule from storage
     */
    async deleteSchedule(scheduleId: string): Promise<void> {
        try {
            const key = `${SCHEDULE_PREFIX}${scheduleId}`;
            await this.storageManager.getDatabase().delete(key);

            // Remove from schedule list
            await this.removeScheduleFromList(scheduleId);

            // Clean up execution logs for this schedule
            await this.deleteExecutionLogs(scheduleId);

            this.logger.debug(`Schedule ${scheduleId} deleted from storage`);
        } catch (error) {
            throw SchedulerError.storageWriteFailed(
                'delete schedule',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Save an execution log
     */
    async saveExecutionLog(log: ExecutionLog): Promise<void> {
        try {
            const key = `${EXECUTION_LOG_PREFIX}${log.scheduleId}:${log.id}`;
            await this.storageManager.getDatabase().set(key, log);

            // Maintain execution history limit
            await this.pruneExecutionHistory(log.scheduleId);

            this.logger.debug(`Execution log ${log.id} saved for schedule ${log.scheduleId}`, {
                status: log.status,
            });
        } catch (error) {
            throw SchedulerError.storageWriteFailed(
                'save execution log',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Get execution logs for a schedule
     */
    async getExecutionLogs(scheduleId: string, limit?: number): Promise<ExecutionLog[]> {
        try {
            const prefix = `${EXECUTION_LOG_PREFIX}${scheduleId}:`;
            const keys = await this.storageManager.getDatabase().list(prefix);

            // Load all logs
            const logs: ExecutionLog[] = [];
            for (const key of keys) {
                const log = await this.storageManager.getDatabase().get<ExecutionLog>(key);
                if (log) {
                    logs.push(log);
                }
            }

            // Sort by triggered time (most recent first)
            logs.sort((a, b) => b.triggeredAt - a.triggeredAt);

            // Apply limit if specified
            return limit ? logs.slice(0, limit) : logs;
        } catch (error) {
            throw SchedulerError.storageReadFailed(
                'get execution logs',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Delete all execution logs for a schedule
     */
    private async deleteExecutionLogs(scheduleId: string): Promise<void> {
        try {
            const prefix = `${EXECUTION_LOG_PREFIX}${scheduleId}:`;
            const keys = await this.storageManager.getDatabase().list(prefix);

            for (const key of keys) {
                await this.storageManager.getDatabase().delete(key);
            }

            this.logger.debug(`Execution logs deleted for schedule ${scheduleId}`);
        } catch (error) {
            // Log error but don't throw - this is cleanup
            this.logger.error(
                `Failed to delete execution logs for schedule ${scheduleId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Prune execution history to maintain limit
     */
    private async pruneExecutionHistory(scheduleId: string): Promise<void> {
        try {
            const logs = await this.getExecutionLogs(scheduleId);

            // If over limit, delete oldest logs
            if (logs.length > this.maxExecutionHistory) {
                const logsToDelete = logs.slice(this.maxExecutionHistory);

                for (const log of logsToDelete) {
                    const key = `${EXECUTION_LOG_PREFIX}${scheduleId}:${log.id}`;
                    await this.storageManager.getDatabase().delete(key);
                }

                this.logger.debug(
                    `Pruned ${logsToDelete.length} old execution logs for schedule ${scheduleId}`
                );
            }
        } catch (error) {
            // Log error but don't throw - this is cleanup
            this.logger.error(
                `Failed to prune execution history for schedule ${scheduleId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Add schedule ID to master list
     */
    private async addScheduleToList(scheduleId: string): Promise<void> {
        const scheduleIds =
            (await this.storageManager.getDatabase().get<string[]>(SCHEDULE_LIST_KEY)) || [];

        if (!scheduleIds.includes(scheduleId)) {
            scheduleIds.push(scheduleId);
            await this.storageManager.getDatabase().set(SCHEDULE_LIST_KEY, scheduleIds);
        }
    }

    /**
     * Remove schedule ID from master list
     */
    private async removeScheduleFromList(scheduleId: string): Promise<void> {
        const scheduleIds =
            (await this.storageManager.getDatabase().get<string[]>(SCHEDULE_LIST_KEY)) || [];

        const filtered = scheduleIds.filter((id) => id !== scheduleId);

        await this.storageManager.getDatabase().set(SCHEDULE_LIST_KEY, filtered);
    }
}
