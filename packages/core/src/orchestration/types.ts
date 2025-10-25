/**
 * Orchestration Service Types
 *
 * Types for task management, todo lists, and workflow orchestration
 */

/**
 * Todo item status
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Todo item with system metadata
 */
export interface Todo {
    id: string;
    sessionId: string;
    content: string;
    activeForm: string;
    status: TodoStatus;
    position: number;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Todo input from tool (without system metadata)
 */
export interface TodoInput {
    content: string;
    activeForm: string;
    status: TodoStatus;
}

/**
 * Todo list update result
 */
export interface TodoUpdateResult {
    todos: Todo[];
    sessionId: string;
    created: number;
    updated: number;
    deleted: number;
}

/**
 * Configuration for OrchestrationService
 */
export interface OrchestrationConfig {
    /** Maximum todos per session */
    maxTodosPerSession?: number;
    /** Enable real-time events */
    enableEvents?: boolean;
    /** Maximum spawned tasks per session */
    maxSpawnedTasksPerSession?: number;
}

/**
 * Spawned task status
 */
export type SpawnedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Spawned task (sub-agent task)
 */
export interface SpawnedTask {
    id: string;
    sessionId: string;
    prompt: string;
    description?: string;
    status: SpawnedTaskStatus;
    result?: string;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
}

/**
 * Spawned task input from tool
 */
export interface SpawnTaskInput {
    prompt: string;
    description?: string;
}

/**
 * Spawned task result
 */
export interface SpawnTaskResult {
    taskId: string;
    sessionId: string;
    prompt: string;
    description?: string;
    status: SpawnedTaskStatus;
}
