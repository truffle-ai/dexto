/**
 * Todo Service Types
 *
 * Types for todo list management and workflow tracking
 */

/**
 * Valid todo status values
 * Centralized constant to prevent duplication across domains
 */
export const TODO_STATUS_VALUES = ['pending', 'in_progress', 'completed'] as const;

/**
 * Todo item status
 */
export type TodoStatus = (typeof TODO_STATUS_VALUES)[number];

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
 * Configuration for TodoService
 */
export interface TodoConfig {
    /** Maximum todos per session */
    maxTodosPerSession?: number;
    /** Enable real-time events */
    enableEvents?: boolean;
}
