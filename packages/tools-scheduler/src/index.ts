/**
 * @dexto/tools-scheduler
 *
 * Scheduler tools provider for Dexto agents.
 * Enables proactive agent behavior through cron-based task scheduling.
 */

// Main factory export (image-compatible)
export { schedulerToolsFactory } from './tool-provider.js';

// Configuration and schemas
export {
    SchedulerToolsConfigSchema,
    type SchedulerToolsConfig,
    ScheduleSessionModeSchema,
    type ScheduleSessionMode,
    CreateScheduleInputSchema,
    type CreateScheduleInput,
    UpdateScheduleInputSchema,
    type UpdateScheduleInput,
    ListSchedulesInputSchema,
    type ListSchedulesInput,
    GetScheduleInputSchema,
    type GetScheduleInput,
    DeleteScheduleInputSchema,
    type DeleteScheduleInput,
    TriggerScheduleInputSchema,
    type TriggerScheduleInput,
    GetScheduleHistoryInputSchema,
    type GetScheduleHistoryInput,
} from './schemas.js';

// Types
export type { Schedule, ExecutionLog, ScheduleFilters, ScheduleExecutorFn } from './types.js';

// Error handling
export { SchedulerError } from './errors.js';
export { SchedulerErrorCode } from './error-codes.js';
