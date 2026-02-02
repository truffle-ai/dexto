/**
 * Orchestration Types
 *
 * Core type definitions for the agent orchestration layer.
 * Defines tasks, signals, wait conditions, and agent states.
 */

/**
 * Task result from agent or process execution
 */
export interface TaskResult {
    success: boolean;
    response?: string;
    error?: string;
    agentId?: string;
    tokenUsage?: {
        input: number;
        output: number;
        total: number;
    };
}

/**
 * Process result from shell command execution
 */
export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration?: number;
}

/**
 * Task types - discriminated union of different background task kinds
 */
export type Task =
    | {
          type: 'agent';
          taskId: string;
          agentId: string;
          taskDescription: string;
          promise: Promise<TaskResult>;
      }
    | {
          type: 'process';
          taskId: string;
          processId: string;
          command: string;
          promise: Promise<ProcessResult>;
      }
    | {
          type: 'generic';
          taskId: string;
          description: string;
          promise: Promise<unknown>;
      };

/**
 * Task lifecycle status
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Entry in the task registry tracking a background task
 */
export interface TaskEntry {
    task: Task;
    status: TaskStatus;
    startedAt: Date;
    completedAt?: Date;
    result?: unknown;
    error?: string;
    /** If true, auto-trigger agent turn on completion */
    notify?: boolean;
}

/**
 * Signal types - events that trigger state transitions
 */
export type Signal =
    | { type: 'task:completed'; taskId: string; result: unknown }
    | { type: 'task:failed'; taskId: string; error: string }
    | { type: 'task:cancelled'; taskId: string }
    | { type: 'timeout'; conditionId: string }
    | { type: 'user:input'; content: string; sessionId: string }
    | { type: 'external'; source: string; data: unknown };

/**
 * Extract signal type string
 */
export type SignalType = Signal['type'];

/**
 * Wait conditions - composable conditions for suspension
 */
export type WaitCondition =
    | { type: 'task'; taskId: string }
    | { type: 'any'; conditions: WaitCondition[] }
    | { type: 'all'; conditions: WaitCondition[] }
    | { type: 'timeout'; ms: number; conditionId: string }
    | { type: 'race'; task: WaitCondition; timeout: WaitCondition };

/**
 * Agent loop states
 */
export type AgentState = 'idle' | 'processing' | 'waiting';

/**
 * Task info returned by list/check operations (without internal promise)
 */
export interface TaskInfo {
    taskId: string;
    type: Task['type'];
    status: TaskStatus;
    startedAt: Date;
    completedAt?: Date;
    duration?: number;
    description?: string;
    result?: unknown;
    error?: string;
}

/**
 * Filter options for listing tasks
 */
export interface TaskFilter {
    status?: TaskStatus | TaskStatus[];
    type?: Task['type'];
}

/**
 * Result from waiting on a condition
 */
export interface WaitResult {
    signal: Signal;
    /** For 'all' conditions, contains all signals */
    allSignals?: Signal[];
}

/**
 * Options for registering a task
 */
export interface RegisterTaskOptions {
    /** Auto-trigger agent turn on completion */
    notify?: boolean;
    /** Timeout in milliseconds */
    timeout?: number;
}
