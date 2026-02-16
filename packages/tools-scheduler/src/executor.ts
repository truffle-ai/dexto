/**
 * Schedule executor - handles execution of scheduled tasks
 */

import { randomUUID } from 'crypto';
import type { Logger } from '@dexto/core';
import type { Schedule, ExecutionLog, ScheduleExecutorFn } from './types.js';
import { SchedulerError } from './errors.js';

/**
 * Executes scheduled tasks by calling the provided executor function
 */
export class ScheduleExecutor {
    private executorFn: ScheduleExecutorFn | null = null;

    constructor(
        private executionTimeout: number,
        private logger: Logger
    ) {}

    /**
     * Set the executor function (called to run the agent with a prompt)
     */
    setExecutor(fn: ScheduleExecutorFn): void {
        this.executorFn = fn;
    }

    /**
     * Resolve the session ID based on the schedule's session mode
     *
     * - ephemeral: New unique session each execution
     * - dedicated: Persistent session per schedule (schedule-{id})
     * - inherit: Use the captured session from schedule creation
     * - fixed: Use the explicitly provided sessionId
     */
    private resolveSessionId(schedule: Schedule): string {
        switch (schedule.sessionMode) {
            case 'ephemeral':
                return `schedule-${schedule.id}-${Date.now()}`;

            case 'dedicated':
                return `schedule-${schedule.id}`;

            case 'inherit':
            case 'fixed':
                if (!schedule.sessionId) {
                    // Fallback to ephemeral if sessionId is missing (shouldn't happen with validation)
                    this.logger.warn(
                        `Schedule ${schedule.id} has sessionMode '${schedule.sessionMode}' but no sessionId. Falling back to ephemeral.`
                    );
                    return `schedule-${schedule.id}-${Date.now()}`;
                }
                return schedule.sessionId;

            default:
                // Default to ephemeral for unknown modes
                return `schedule-${schedule.id}-${Date.now()}`;
        }
    }

    /**
     * Execute a scheduled task
     */
    async execute(schedule: Schedule): Promise<ExecutionLog> {
        if (!this.executorFn) {
            throw SchedulerError.executionFailed(schedule.id, 'Executor not initialized');
        }

        const startTime = Date.now();
        const log: ExecutionLog = {
            id: randomUUID(),
            scheduleId: schedule.id,
            triggeredAt: startTime,
            status: 'pending',
        };

        // Resolve session ID based on session mode
        const sessionId = this.resolveSessionId(schedule);

        try {
            this.logger.info(`Executing schedule: ${schedule.name}`, {
                scheduleId: schedule.id,
                executionId: log.id,
                sessionId,
                sessionMode: schedule.sessionMode,
                cronExpression: schedule.cronExpression,
            });

            // Execute with timeout
            const result = await this.executeWithTimeout(schedule, sessionId);

            const completedAt = Date.now();
            log.completedAt = completedAt;
            log.duration = completedAt - startTime;
            log.status = 'success';
            log.result = result;

            this.logger.info(`Schedule executed successfully: ${schedule.name}`, {
                scheduleId: schedule.id,
                executionId: log.id,
                sessionId,
                durationMs: log.duration,
            });
        } catch (error) {
            const completedAt = Date.now();
            log.completedAt = completedAt;
            log.duration = completedAt - startTime;

            if (error instanceof Error && error.name === 'TimeoutError') {
                log.status = 'timeout';
                log.error = `Execution timed out after ${this.executionTimeout}ms`;
            } else {
                log.status = 'failed';
                log.error = error instanceof Error ? error.message : String(error);
            }

            this.logger.error(`Schedule execution failed: ${schedule.name}`, {
                scheduleId: schedule.id,
                executionId: log.id,
                sessionId,
                error: log.error,
                durationMs: log.duration,
            });
        }

        return log;
    }

    /**
     * Execute task with timeout
     */
    private async executeWithTimeout(schedule: Schedule, sessionId: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const error = new Error('Execution timeout');
                error.name = 'TimeoutError';
                reject(error);
            }, this.executionTimeout);

            // Wrap prompt with execution context
            const contextualPrompt = this.wrapPromptWithContext(schedule);

            // Execute via the executor function
            this.executorFn!({ prompt: contextualPrompt, sessionId, schedule })
                .then((result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * Wrap prompt with execution context
     * Provides context that this is a scheduled automation trigger
     */
    private wrapPromptWithContext(schedule: Schedule): string {
        const scheduleInfo = [
            `<scheduled_automation_trigger>`,
            `Task: ${schedule.name}`,
            `Schedule: ${schedule.cronExpression} (${schedule.timezone})`,
            `Triggered at: ${new Date().toISOString()}`,
            `</scheduled_automation_trigger>`,
            ``,
            schedule.task.instruction,
        ].join('\n');

        return scheduleInfo;
    }
}
