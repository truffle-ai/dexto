/**
 * Core types for scheduler tool provider
 */

/**
 * Session mode determines how the scheduler manages conversation context for executions.
 *
 * - `ephemeral`: Creates a new isolated session for each execution. Best for standalone
 *   automated tasks like reports or monitoring that don't need conversation history.
 *
 * - `dedicated`: Uses a single persistent session for this schedule (`schedule-{id}`).
 *   Each execution continues the same conversation thread, building context over time.
 *   Good for ongoing projects or tasks that should remember previous runs.
 *
 * - `inherit`: Captures the session from where the schedule was created and reuses it.
 *   Perfect for "remind me about this later" or "check back on this in an hour" scenarios
 *   where you want to continue the current conversation at a scheduled time.
 *
 * - `fixed`: Uses an explicitly provided sessionId. Advanced mode for orchestrating
 *   across multiple known sessions or threads.
 */
export type ScheduleSessionMode = 'ephemeral' | 'dedicated' | 'inherit' | 'fixed';

/**
 * Schedule definition for automated task execution
 */
export interface Schedule {
    id: string;
    /** Human-readable name for the schedule (e.g., "Coffee Reminder") */
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    task: {
        /** Instruction for the executing agent */
        instruction: string;
        metadata?: Record<string, unknown>;
    };
    /**
     * How session context is managed for executions.
     * @default 'ephemeral'
     */
    sessionMode: ScheduleSessionMode;
    /**
     * Session ID for 'fixed' mode, or captured session for 'inherit' mode.
     * Not used for 'ephemeral' or 'dedicated' modes.
     */
    sessionId?: string;
    /** Optional workspace path for executions */
    workspacePath?: string;
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;
    nextRunAt?: number;
    runCount: number;
    successCount: number;
    failureCount: number;
    lastError?: string;
}

/**
 * Execution log entry for schedule runs
 */
export interface ExecutionLog {
    id: string;
    scheduleId: string;
    triggeredAt: number;
    completedAt?: number;
    status: 'pending' | 'success' | 'failed' | 'timeout';
    duration?: number;
    error?: string;
    result?: string;
}

/**
 * Scheduler configuration (from customTools config)
 */
export interface SchedulerConfig {
    type: 'scheduler-tools';
    timezone: string;
    maxSchedules: number;
    executionTimeout: number;
    maxExecutionHistory: number;
}

/**
 * Schedule filters for listing
 */
export interface ScheduleFilters {
    enabled?: boolean;
}

/**
 * Executor function type - called to execute scheduled tasks
 */
export type ScheduleExecutorFn = (params: {
    prompt: string;
    sessionId: string;
    schedule: Schedule;
}) => Promise<string>;
