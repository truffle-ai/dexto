/**
 * Scheduler Manager - Core service for internal task scheduling
 */

import cron from 'node-cron';
import * as cronParser from 'cron-parser';
import { randomUUID } from 'crypto';
import type { StorageManager, Logger } from '@dexto/core';
import type { SchedulerToolsConfig } from './schemas.js';
import {
    CreateScheduleInputSchema,
    UpdateScheduleFieldsOnlySchema,
    type CreateScheduleInput,
    type UpdateScheduleInput,
} from './schemas.js';
import type { Schedule, ExecutionLog, ScheduleFilters, ScheduleExecutorFn } from './types.js';
import { ScheduleStorage } from './storage.js';
import { ScheduleExecutor } from './executor.js';
import { SchedulerError } from './errors.js';

/**
 * Scheduler Manager
 *
 * Core service for internal task scheduling. Manages cron-based schedules
 * that execute tasks via the agent.
 *
 * Key features:
 * - Cron-based scheduling with timezone support
 * - Persistent schedules (survive agent restarts)
 * - Direct agent execution (zero HTTP overhead)
 * - Logging-based observability
 * - Self-configurable via tools
 */
export class SchedulerManager {
    private cronTasks: Map<string, cron.ScheduledTask> = new Map();
    private storage: ScheduleStorage;
    private executor: ScheduleExecutor;
    private executionChain: Promise<void> = Promise.resolve();
    private initialized = false;
    private started = false;

    constructor(
        storageManager: StorageManager,
        private config: SchedulerToolsConfig,
        private logger: Logger
    ) {
        this.storage = new ScheduleStorage(storageManager, config.maxExecutionHistory, logger);
        this.executor = new ScheduleExecutor(config.executionTimeout, logger);
    }

    /**
     * Set the executor function (called to run the agent with a prompt)
     */
    setExecutor(fn: ScheduleExecutorFn): void {
        this.executor.setExecutor(fn);
    }

    /**
     * Initialize the scheduler (load schedules from storage)
     */
    async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Load schedules from storage
            const storedSchedules = await this.storage.listSchedules();
            this.logger.info(`Loaded ${storedSchedules.length} schedules from storage`);

            this.initialized = true;
        } catch (error) {
            throw SchedulerError.invalidConfig(
                `Failed to initialize scheduler: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Start the scheduler (begin executing schedules)
     */
    async start(): Promise<void> {
        if (!this.initialized) {
            await this.init();
        }

        if (this.started) {
            return;
        }

        try {
            // Load all schedules
            const schedules = await this.storage.listSchedules();

            // Schedule all enabled tasks
            for (const schedule of schedules) {
                if (schedule.enabled) {
                    await this.scheduleTask(schedule);
                }
            }

            this.started = true;
            this.logger.info(`Scheduler started with ${this.cronTasks.size} active schedules`);
        } catch (error) {
            throw SchedulerError.invalidConfig(
                `Failed to start scheduler: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Stop the scheduler (stop all running tasks)
     */
    async stop(): Promise<void> {
        if (!this.started) {
            return;
        }

        // Stop all cron tasks
        for (const task of this.cronTasks.values()) {
            task.stop();
        }

        this.cronTasks.clear();
        this.started = false;

        this.logger.info('Scheduler stopped');
    }

    /**
     * Create a new schedule
     *
     * @param input - Schedule creation input
     * @param currentSessionId - The current session ID (used for 'inherit' mode)
     */
    async createSchedule(input: CreateScheduleInput, currentSessionId?: string): Promise<Schedule> {
        // Validate input
        const validated = CreateScheduleInputSchema.parse(input);

        // Check schedule limit
        const existingSchedules = await this.storage.listSchedules();
        if (existingSchedules.length >= this.config.maxSchedules) {
            throw SchedulerError.limitReached(existingSchedules.length, this.config.maxSchedules);
        }

        // Validate cron expression
        if (!cron.validate(validated.cronExpression)) {
            throw SchedulerError.invalidCron(validated.cronExpression, 'Invalid cron format');
        }

        // Resolve sessionId based on mode
        let resolvedSessionId: string | undefined;
        const sessionMode = validated.sessionMode ?? 'ephemeral';

        if (sessionMode === 'inherit') {
            // For inherit mode, capture the current session
            if (!currentSessionId) {
                throw SchedulerError.invalidInput(
                    'sessionMode "inherit" requires a current session context'
                );
            }
            resolvedSessionId = currentSessionId;
        } else if (sessionMode === 'fixed') {
            // For fixed mode, use the provided sessionId (already validated by schema)
            resolvedSessionId = validated.sessionId;
        }
        // ephemeral and dedicated don't need sessionId stored

        // Create schedule
        const now = Date.now();

        // Build task metadata (includes targetAgentId if specified)
        const taskMetadata: Record<string, unknown> = {
            ...validated.metadata,
        };
        if (validated.targetAgentId) {
            taskMetadata.__os_targetAgentId = validated.targetAgentId;
        }

        const workspacePath =
            validated.workspacePath && validated.workspacePath.trim().length > 0
                ? validated.workspacePath
                : undefined;

        const schedule: Schedule = {
            id: randomUUID(),
            name: validated.name,
            cronExpression: validated.cronExpression,
            timezone: validated.timezone || this.config.timezone,
            enabled: validated.enabled,
            task: {
                instruction: validated.instruction,
                ...(Object.keys(taskMetadata).length > 0 && { metadata: taskMetadata }),
            },
            sessionMode,
            ...(resolvedSessionId && { sessionId: resolvedSessionId }),
            ...(workspacePath ? { workspacePath } : {}),
            createdAt: now,
            updatedAt: now,
            runCount: 0,
            successCount: 0,
            failureCount: 0,
        };

        // Calculate next run time
        const nextRun = this.calculateNextRun(schedule);
        if (nextRun !== undefined) {
            schedule.nextRunAt = nextRun;
        }

        // Save to storage
        await this.storage.saveSchedule(schedule);

        // Schedule if enabled and scheduler is running
        if (schedule.enabled && this.started) {
            await this.scheduleTask(schedule);
        }

        this.logger.info(`Schedule created: ${schedule.name}`, {
            scheduleId: schedule.id,
            sessionMode,
            cronExpression: schedule.cronExpression,
        });

        return schedule;
    }

    /**
     * Update an existing schedule
     *
     * @param scheduleId - The schedule ID to update
     * @param updates - The updates to apply
     * @param currentSessionId - The current session ID (used if changing to 'inherit' mode)
     */
    async updateSchedule(
        scheduleId: string,
        updates: Omit<UpdateScheduleInput, 'scheduleId'>,
        currentSessionId?: string
    ): Promise<Schedule> {
        // Validate input
        const validated = UpdateScheduleFieldsOnlySchema.parse(updates);

        // Load existing schedule
        const existing = await this.storage.loadSchedule(scheduleId);
        if (!existing) {
            throw SchedulerError.notFound(scheduleId);
        }

        // Validate cron expression if provided
        if (validated.cronExpression && !cron.validate(validated.cronExpression)) {
            throw SchedulerError.invalidCron(validated.cronExpression, 'Invalid cron format');
        }

        // Handle sessionMode updates
        let updatedSessionId = existing.sessionId;
        const newSessionMode = validated.sessionMode ?? existing.sessionMode;

        if (validated.sessionMode !== undefined) {
            if (newSessionMode === 'inherit') {
                if (!currentSessionId) {
                    throw SchedulerError.invalidInput(
                        'sessionMode "inherit" requires a current session context'
                    );
                }
                updatedSessionId = currentSessionId;
            } else if (newSessionMode === 'fixed') {
                // sessionId is required for fixed mode (validated by schema)
                updatedSessionId = validated.sessionId;
            } else {
                // ephemeral or dedicated - clear stored sessionId
                updatedSessionId = undefined;
            }
        } else if (validated.sessionId !== undefined) {
            // Allow updating sessionId for fixed mode without changing mode
            updatedSessionId = validated.sessionId;
        }

        // Handle targetAgentId update (stored in task.metadata)
        let updatedTaskMetadata = { ...existing.task.metadata };
        if (validated.targetAgentId !== undefined) {
            if (validated.targetAgentId) {
                updatedTaskMetadata.__os_targetAgentId = validated.targetAgentId;
            } else {
                // Empty string or null means clear the target agent
                delete updatedTaskMetadata.__os_targetAgentId;
            }
        }
        if (validated.metadata !== undefined) {
            // Merge user metadata while preserving __os_ prefixed keys
            const osKeys = Object.keys(updatedTaskMetadata).filter((k) => k.startsWith('__os_'));
            updatedTaskMetadata = {
                ...validated.metadata,
            };
            for (const key of osKeys) {
                if (existing.task.metadata?.[key] !== undefined || key === '__os_targetAgentId') {
                    updatedTaskMetadata[key] = existing.task.metadata?.[key];
                }
            }
            // Re-apply targetAgentId if it was updated
            if (validated.targetAgentId) {
                updatedTaskMetadata.__os_targetAgentId = validated.targetAgentId;
            }
        }

        const resolvedWorkspacePath =
            validated.workspacePath === undefined
                ? existing.workspacePath
                : validated.workspacePath && validated.workspacePath.trim().length > 0
                  ? validated.workspacePath
                  : undefined;

        // Apply updates
        const updated: Schedule = {
            ...existing,
            ...(validated.name !== undefined && { name: validated.name }),
            ...(validated.cronExpression !== undefined && {
                cronExpression: validated.cronExpression,
            }),
            ...(validated.timezone !== undefined && { timezone: validated.timezone }),
            ...(validated.enabled !== undefined && { enabled: validated.enabled }),
            task: {
                ...existing.task,
                ...(validated.instruction !== undefined && { instruction: validated.instruction }),
                ...(Object.keys(updatedTaskMetadata).length > 0
                    ? { metadata: updatedTaskMetadata }
                    : {}),
            },
            sessionMode: newSessionMode,
            ...(updatedSessionId !== undefined ? { sessionId: updatedSessionId } : {}),
            updatedAt: Date.now(),
        };

        if (resolvedWorkspacePath) {
            updated.workspacePath = resolvedWorkspacePath;
        } else {
            delete (updated as { workspacePath?: string }).workspacePath;
        }

        // Remove sessionId if switching to ephemeral/dedicated (where it's not used)
        if (newSessionMode === 'ephemeral' || newSessionMode === 'dedicated') {
            delete (updated as { sessionId?: string }).sessionId;
        }

        // Recalculate next run time
        const nextRunTime = this.calculateNextRun(updated);
        if (nextRunTime !== undefined) {
            updated.nextRunAt = nextRunTime;
        }

        // Save to storage
        await this.storage.saveSchedule(updated);

        // Reschedule if running
        if (this.started) {
            this.unscheduleTask(scheduleId);
            if (updated.enabled) {
                await this.scheduleTask(updated);
            }
        }

        this.logger.info(`Schedule updated: ${updated.name}`, {
            scheduleId,
            sessionMode: newSessionMode,
        });

        return updated;
    }

    /**
     * Delete a schedule
     */
    async deleteSchedule(scheduleId: string): Promise<void> {
        // Load schedule
        const schedule = await this.storage.loadSchedule(scheduleId);
        if (!schedule) {
            throw SchedulerError.notFound(scheduleId);
        }

        // Unschedule if running
        if (this.started) {
            this.unscheduleTask(scheduleId);
        }

        // Delete from storage
        await this.storage.deleteSchedule(scheduleId);

        this.logger.info(`Schedule deleted: ${schedule.name}`, { scheduleId });
    }

    /**
     * Get a schedule by ID
     */
    async getSchedule(scheduleId: string): Promise<Schedule | null> {
        return this.storage.loadSchedule(scheduleId);
    }

    /**
     * List schedules with optional filters
     */
    async listSchedules(filters?: ScheduleFilters): Promise<Schedule[]> {
        const schedules = await this.storage.listSchedules();

        if (!filters) {
            return schedules;
        }

        return schedules.filter((schedule) => {
            if (filters.enabled !== undefined && schedule.enabled !== filters.enabled) {
                return false;
            }
            return true;
        });
    }

    /**
     * Trigger a schedule immediately (manual execution)
     */
    async triggerScheduleNow(scheduleId: string): Promise<ExecutionLog> {
        const schedule = await this.storage.loadSchedule(scheduleId);
        if (!schedule) {
            throw SchedulerError.notFound(scheduleId);
        }

        this.logger.info(`Manually triggering schedule: ${schedule.name}`, { scheduleId });

        return this.executeSchedule(schedule);
    }

    /**
     * Get execution history for a schedule
     */
    async getExecutionHistory(scheduleId: string, limit?: number): Promise<ExecutionLog[]> {
        return this.storage.getExecutionLogs(scheduleId, limit);
    }

    /**
     * Get scheduler status
     */
    getStatus(): {
        initialized: boolean;
        started: boolean;
        activeSchedules: number;
    } {
        return {
            initialized: this.initialized,
            started: this.started,
            activeSchedules: this.cronTasks.size,
        };
    }

    /**
     * Schedule a task using cron
     */
    private async scheduleTask(schedule: Schedule): Promise<void> {
        // Remove existing task if any
        this.unscheduleTask(schedule.id);

        if (!schedule.enabled) {
            return;
        }

        try {
            // Create cron task
            const task = cron.schedule(
                schedule.cronExpression,
                () => {
                    this.executeSchedule(schedule).catch((error) => {
                        this.logger.error(
                            `Failed to execute schedule ${schedule.id}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    });
                },
                {
                    timezone: schedule.timezone,
                    name: schedule.id,
                }
            );
            // Start the task
            task.start();

            this.cronTasks.set(schedule.id, task);

            this.logger.debug(`Schedule task registered: ${schedule.name}`, {
                scheduleId: schedule.id,
                cronExpression: schedule.cronExpression,
            });
        } catch (error) {
            throw SchedulerError.createFailed(
                `Failed to schedule task: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Unschedule a task
     */
    private unscheduleTask(scheduleId: string): void {
        const task = this.cronTasks.get(scheduleId);
        if (task) {
            task.stop();
            this.cronTasks.delete(scheduleId);
            this.logger.debug(`Schedule task unregistered: ${scheduleId}`);
        }
    }

    /**
     * Execute a schedule
     */
    private async executeSchedule(schedule: Schedule): Promise<ExecutionLog> {
        return await this.queueExecution(() => this.executeScheduleInternal(schedule));
    }

    private async executeScheduleInternal(schedule: Schedule): Promise<ExecutionLog> {
        try {
            const current = await this.storage.loadSchedule(schedule.id);
            if (!current) {
                throw SchedulerError.notFound(schedule.id);
            }

            // Execute via executor
            const log = await this.executor.execute(current);

            // Save execution log
            await this.storage.saveExecutionLog(log);

            // Update schedule metadata
            const updates: Partial<Schedule> = {
                lastRunAt: log.triggeredAt,
                runCount: current.runCount + 1,
                updatedAt: Date.now(),
            };

            if (log.status === 'success') {
                updates.successCount = current.successCount + 1;
            } else if (log.status === 'failed' || log.status === 'timeout') {
                updates.failureCount = current.failureCount + 1;
                if (log.error) {
                    updates.lastError = log.error;
                }
            }

            // Calculate next run
            const nextRun = this.calculateNextRun(current);
            if (nextRun !== undefined) {
                updates.nextRunAt = nextRun;
            }

            // Update schedule
            const updated = { ...current, ...updates };
            await this.storage.saveSchedule(updated);

            return log;
        } catch (error) {
            throw SchedulerError.executionFailed(
                schedule.id,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private queueExecution<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.executionChain.then(fn);
        this.executionChain = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /**
     * Calculate next run time for a schedule
     */
    private calculateNextRun(schedule: Schedule): number | undefined {
        try {
            const interval = cronParser.parseExpression(schedule.cronExpression, {
                tz: schedule.timezone,
            });
            const next = interval.next();
            const nextDate = next instanceof Date ? next : next.toDate();
            return nextDate.getTime();
        } catch (error) {
            this.logger.error(
                `Failed to calculate next run: ${error instanceof Error ? error.message : String(error)}`
            );
            return undefined;
        }
    }
}
