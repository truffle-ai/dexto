/**
 * @dexto/tools-scheduler
 *
 * Scheduler tools provider for Dexto agents.
 * Enables proactive agent behavior through cron-based task scheduling.
 */

// Main factory export (image-compatible)
export {
    schedulerToolsFactory,
    getSchedulerManager,
    ensureSchedulerManagerForAgent,
    createSchedulerTools,
} from './tool-provider.js';

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
export type {
    Schedule,
    ScheduleSessionMode as ScheduleSessionModeType,
    ExecutionLog,
    SchedulerConfig,
    ScheduleFilters,
    ScheduleExecutorFn,
} from './types.js';

// Error handling
export { SchedulerError } from './errors.js';
export { SchedulerErrorCode } from './error-codes.js';

// Core services (for advanced use cases)
export { SchedulerManager } from './manager.js';
export { ScheduleStorage } from './storage.js';
export { ScheduleExecutor } from './executor.js';

// Tool factory types
export type { SchedulerManagerGetter } from './tool-types.js';

// Tool implementations (for custom integrations)
export { createCreateScheduleTool } from './tools/create-schedule.js';
export { createListSchedulesTool } from './tools/list-schedules.js';
export { createGetScheduleTool } from './tools/get-schedule.js';
export { createUpdateScheduleTool } from './tools/update-schedule.js';
export { createDeleteScheduleTool } from './tools/delete-schedule.js';
export { createTriggerScheduleTool } from './tools/trigger-schedule.js';
export { createGetScheduleHistoryTool } from './tools/get-history.js';
