/**
 * Error classes for scheduler operations
 */

import { DextoRuntimeError, ErrorType } from '@dexto/core';
import { SchedulerErrorCode } from './error-codes.js';

/**
 * Scheduler error scope (string literal since scheduler is external to core)
 */
export const SCHEDULER_ERROR_SCOPE = 'scheduler' as const;

/**
 * Scheduler error factory methods
 * Creates properly typed errors for scheduler operations
 */
export class SchedulerError {
    static notEnabled() {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULER_NOT_ENABLED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.USER,
            'Scheduler is not enabled in configuration',
            undefined,
            'Add scheduler-tools to customTools in your agent configuration'
        );
    }

    static missingStorage() {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULER_MISSING_STORAGE,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            'StorageManager is required but not available',
            undefined,
            'Ensure StorageManager is available in context.services'
        );
    }

    static invalidConfig(details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULER_INVALID_CONFIG,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.USER,
            `Invalid scheduler configuration: ${details}`,
            { details }
        );
    }

    static invalidCron(expression: string, details?: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_INVALID_CRON,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.USER,
            `Invalid cron expression: ${expression}${details ? ` - ${details}` : ''}`,
            { expression, details }
        );
    }

    static invalidInput(details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_INVALID_INPUT,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.USER,
            `Invalid schedule input: ${details}`,
            { details }
        );
    }

    static limitReached(current: number, max: number) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_LIMIT_REACHED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.USER,
            `Schedule limit reached: ${current}/${max}`,
            { current, max },
            'Delete unused schedules or increase maxSchedules in configuration'
        );
    }

    static notFound(scheduleId: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_NOT_FOUND,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.NOT_FOUND,
            `Schedule not found: ${scheduleId}`,
            { scheduleId }
        );
    }

    static createFailed(details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_CREATE_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Failed to create schedule: ${details}`,
            { details }
        );
    }

    static updateFailed(scheduleId: string, details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_UPDATE_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Failed to update schedule ${scheduleId}: ${details}`,
            { scheduleId, details }
        );
    }

    static deleteFailed(scheduleId: string, details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_DELETE_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Failed to delete schedule ${scheduleId}: ${details}`,
            { scheduleId, details }
        );
    }

    static executionFailed(scheduleId: string, details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_EXECUTION_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Schedule execution failed for ${scheduleId}: ${details}`,
            { scheduleId, details }
        );
    }

    static executionTimeout(scheduleId: string, timeout: number) {
        return new DextoRuntimeError(
            SchedulerErrorCode.SCHEDULE_EXECUTION_TIMEOUT,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.TIMEOUT,
            `Schedule execution timed out for ${scheduleId} after ${timeout}ms`,
            { scheduleId, timeout }
        );
    }

    static storageReadFailed(operation: string, details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.STORAGE_READ_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Storage read failed for ${operation}: ${details}`,
            { operation, details }
        );
    }

    static storageWriteFailed(operation: string, details: string) {
        return new DextoRuntimeError(
            SchedulerErrorCode.STORAGE_WRITE_FAILED,
            SCHEDULER_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Storage write failed for ${operation}: ${details}`,
            { operation, details }
        );
    }
}
