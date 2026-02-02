/**
 * TaskRegistry
 *
 * Tracks all background tasks and their results.
 * Emits signals on task completion for the ConditionEngine.
 */

import type {
    Task,
    TaskEntry,
    TaskStatus,
    TaskInfo,
    TaskFilter,
    RegisterTaskOptions,
} from './types.js';
import type { SignalBus } from './signal-bus.js';

/**
 * Configuration for TaskRegistry
 */
export interface TaskRegistryConfig {
    /** Maximum number of concurrent tasks (default: 20) */
    maxTasks?: number;
    /** TTL for completed task results in ms (default: 5 minutes) */
    resultTTL?: number;
}

/**
 * TaskRegistry - Manages background task lifecycle
 */
export class TaskRegistry {
    private tasks = new Map<string, TaskEntry>();
    private signalBus: SignalBus;
    private config: Required<TaskRegistryConfig>;

    constructor(signalBus: SignalBus, config: TaskRegistryConfig = {}) {
        this.signalBus = signalBus;
        this.config = {
            maxTasks: config.maxTasks ?? 20,
            resultTTL: config.resultTTL ?? 5 * 60 * 1000, // 5 minutes
        };
    }

    /**
     * Generate a unique task ID
     */
    private generateTaskId(): string {
        return `task-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Get description from task for display
     */
    private getTaskDescription(task: Task): string {
        switch (task.type) {
            case 'agent':
                return task.taskDescription;
            case 'process':
                return task.command;
            case 'generic':
                return task.description;
        }
    }

    /**
     * Register a new task and start tracking it
     * @param task Task to register (must include promise)
     * @param options Registration options
     * @returns Task ID
     */
    register(task: Task, options: RegisterTaskOptions = {}): string {
        // Check capacity
        const runningCount = this.getRunningCount();
        if (runningCount >= this.config.maxTasks) {
            throw new Error(
                `Maximum concurrent tasks (${this.config.maxTasks}) exceeded. ` +
                    `${runningCount} tasks currently running.`
            );
        }

        const entry: TaskEntry = {
            task,
            status: 'running',
            startedAt: new Date(),
            timeoutHandle: undefined,
            ...(options.notify !== undefined && { notify: options.notify }),
        };

        this.tasks.set(task.taskId, entry);

        // Set up promise handlers to track completion
        task.promise
            .then((result) => {
                this.onTaskComplete(task.taskId, result);
            })
            .catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.onTaskFailed(task.taskId, errorMessage);
            });

        // Set up timeout if specified
        if (options.timeout !== undefined && options.timeout > 0) {
            const timeoutHandle = setTimeout(() => {
                const currentEntry = this.tasks.get(task.taskId);
                if (currentEntry && currentEntry.status === 'running') {
                    this.onTaskFailed(task.taskId, `Task timed out after ${options.timeout}ms`);
                }
            }, options.timeout);
            entry.timeoutHandle = timeoutHandle;
        }

        return task.taskId;
    }

    /**
     * Create and register an agent task
     *
     * Note: Uses agentId as the taskId so the caller can use the same ID
     * for wait_for/check_task operations.
     */
    registerAgentTask(
        agentId: string,
        taskDescription: string,
        promise: Promise<unknown>,
        options: RegisterTaskOptions = {}
    ): string {
        // Use agentId as taskId so spawn_agent's returned ID matches what's registered
        const taskId = agentId;
        if (this.tasks.has(taskId)) {
            throw new Error(`Task '${taskId}' already exists`);
        }
        const task: Task = {
            type: 'agent',
            taskId,
            agentId,
            taskDescription,
            promise: promise as Promise<import('./types.js').TaskResult>,
        };
        return this.register(task, options);
    }

    /**
     * Create and register a process task
     */
    registerProcessTask(
        processId: string,
        command: string,
        promise: Promise<unknown>,
        options: RegisterTaskOptions = {}
    ): string {
        const taskId = this.generateTaskId();
        const task: Task = {
            type: 'process',
            taskId,
            processId,
            command,
            promise: promise as Promise<import('./types.js').ProcessResult>,
        };
        return this.register(task, options);
    }

    /**
     * Create and register a generic task
     */
    registerGenericTask(
        description: string,
        promise: Promise<unknown>,
        options: RegisterTaskOptions = {}
    ): string {
        const taskId = this.generateTaskId();
        const task: Task = {
            type: 'generic',
            taskId,
            description,
            promise,
        };
        return this.register(task, options);
    }

    /**
     * Called when a task completes successfully
     */
    private onTaskComplete(taskId: string, result: unknown): void {
        const entry = this.tasks.get(taskId);
        if (!entry || entry.status !== 'running') {
            return; // Already completed/failed/cancelled
        }

        if (entry.timeoutHandle) {
            clearTimeout(entry.timeoutHandle);
            entry.timeoutHandle = undefined;
        }

        entry.status = 'completed';
        entry.completedAt = new Date();
        entry.result = result;

        // Emit completion signal
        this.signalBus.emit({
            type: 'task:completed',
            taskId,
            result,
        });
    }

    /**
     * Called when a task fails
     */
    private onTaskFailed(taskId: string, error: string): void {
        const entry = this.tasks.get(taskId);
        if (!entry || entry.status !== 'running') {
            return; // Already completed/failed/cancelled
        }

        if (entry.timeoutHandle) {
            clearTimeout(entry.timeoutHandle);
            entry.timeoutHandle = undefined;
        }

        entry.status = 'failed';
        entry.completedAt = new Date();
        entry.error = error;

        // Emit failure signal
        this.signalBus.emit({
            type: 'task:failed',
            taskId,
            error,
        });
    }

    /**
     * Cancel a running task
     */
    cancel(taskId: string): void {
        const entry = this.tasks.get(taskId);
        if (!entry) {
            throw new Error(`Task '${taskId}' not found`);
        }

        if (entry.status !== 'running') {
            return; // Already not running
        }

        if (entry.timeoutHandle) {
            clearTimeout(entry.timeoutHandle);
            entry.timeoutHandle = undefined;
        }

        entry.status = 'cancelled';
        entry.completedAt = new Date();

        // Emit cancellation signal
        this.signalBus.emit({
            type: 'task:cancelled',
            taskId,
        });
    }

    /**
     * Get task entry by ID
     */
    get(taskId: string): TaskEntry | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Get task status
     */
    getStatus(taskId: string): TaskStatus | undefined {
        return this.tasks.get(taskId)?.status;
    }

    /**
     * Get task result (if completed)
     */
    getResult(
        taskId: string
    ): { status: TaskStatus; result?: unknown; error?: string } | undefined {
        const entry = this.tasks.get(taskId);
        if (!entry) {
            return undefined;
        }

        return {
            status: entry.status,
            ...(entry.result !== undefined && { result: entry.result }),
            ...(entry.error !== undefined && { error: entry.error }),
        };
    }

    /**
     * Get task info (safe for serialization - no promise)
     */
    getInfo(taskId: string): TaskInfo | undefined {
        const entry = this.tasks.get(taskId);
        if (!entry) {
            return undefined;
        }

        const duration = entry.completedAt
            ? entry.completedAt.getTime() - entry.startedAt.getTime()
            : undefined;

        return {
            taskId: entry.task.taskId,
            type: entry.task.type,
            status: entry.status,
            startedAt: entry.startedAt,
            description: this.getTaskDescription(entry.task),
            ...(entry.completedAt !== undefined && { completedAt: entry.completedAt }),
            ...(duration !== undefined && { duration }),
            ...(entry.result !== undefined && { result: entry.result }),
            ...(entry.error !== undefined && { error: entry.error }),
        };
    }

    /**
     * List tasks matching filter
     */
    list(filter?: TaskFilter): TaskInfo[] {
        const results: TaskInfo[] = [];

        for (const entry of this.tasks.values()) {
            // Apply status filter
            if (filter?.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                if (!statuses.includes(entry.status)) {
                    continue;
                }
            }

            // Apply type filter
            if (filter?.type && entry.task.type !== filter.type) {
                continue;
            }

            const info = this.getInfo(entry.task.taskId);
            if (info) {
                results.push(info);
            }
        }

        // Sort by startedAt descending (most recent first)
        return results.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    /**
     * Get count of running tasks
     */
    getRunningCount(): number {
        let count = 0;
        for (const entry of this.tasks.values()) {
            if (entry.status === 'running') {
                count++;
            }
        }
        return count;
    }

    /**
     * Get tasks that completed with notify=true and haven't been acknowledged
     */
    getNotifyPending(): TaskInfo[] {
        return this.list({ status: ['completed', 'failed'] }).filter((info) => {
            const entry = this.tasks.get(info.taskId);
            return entry?.notify === true;
        });
    }

    /**
     * Mark notify tasks as acknowledged (clear notify flag)
     */
    acknowledgeNotify(taskIds: string[]): void {
        for (const taskId of taskIds) {
            const entry = this.tasks.get(taskId);
            if (entry) {
                entry.notify = false;
            }
        }
    }

    /**
     * Clean up old completed tasks
     */
    cleanup(olderThan?: Date): number {
        const cutoff = olderThan ?? new Date(Date.now() - this.config.resultTTL);
        let cleaned = 0;

        for (const [taskId, entry] of this.tasks.entries()) {
            if (entry.status !== 'running' && entry.completedAt && entry.completedAt < cutoff) {
                this.tasks.delete(taskId);
                cleaned++;
            }
        }

        return cleaned;
    }

    /**
     * Clear all tasks
     */
    clear(): void {
        this.tasks.clear();
    }

    /**
     * Check if a task exists
     */
    has(taskId: string): boolean {
        return this.tasks.has(taskId);
    }

    /**
     * Get total task count
     */
    get size(): number {
        return this.tasks.size;
    }
}
