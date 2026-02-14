/**
 * @dexto/tools-todo
 *
 * Todo/task tracking tools factory for Dexto agents.
 * Provides the todo_write tool for managing task lists.
 */

// Main factory export (image-compatible)
export { todoToolsFactory } from './tool-factory.js';

// Service and utilities (for advanced use cases)
export { TodoService } from './todo-service.js';
export { TodoError } from './errors.js';
export { TodoErrorCode } from './error-codes.js';

// Types
export type { Todo, TodoInput, TodoStatus, TodoUpdateResult, TodoConfig } from './types.js';
export { TODO_STATUS_VALUES } from './types.js';

// Tool implementations (for custom integrations)
export { createTodoWriteTool } from './todo-write-tool.js';
