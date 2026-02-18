/**
 * Core types for scheduler tool provider
 */

import type { ScheduleSessionMode } from './schemas.js';

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
