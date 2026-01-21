/**
 * Todo Write Tool
 *
 * Manages task lists for tracking agent progress and workflow organization
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '@dexto/core';
import type { TodoService } from './todo-service.js';
import { TODO_STATUS_VALUES } from './types.js';

/**
 * Zod schema for todo item input
 */
const TodoItemSchema = z.object({
    content: z
        .string()
        .min(1)
        .describe('Task description in imperative form (e.g., "Fix authentication bug")'),
    activeForm: z
        .string()
        .min(1)
        .describe(
            'Present continuous form shown during execution (e.g., "Fixing authentication bug")'
        ),
    status: z
        .enum(TODO_STATUS_VALUES)
        .describe(
            'Task status: pending (not started), in_progress (currently working), completed (finished)'
        ),
});

/**
 * Zod schema for todo_write tool input
 */
const TodoWriteInputSchema = z
    .object({
        todos: z
            .array(TodoItemSchema)
            .min(1)
            .describe('Array of todo items representing the complete task list for the session'),
    })
    .strict()
    .describe(
        'Manage task list for current session. Replaces the entire todo list with the provided tasks.'
    );

/**
 * Create todo_write internal tool
 */
export function createTodoWriteTool(todoService: TodoService): InternalTool {
    return {
        id: 'todo_write',
        description:
            'Manage task list for tracking agent progress. Use this to create, update, or track todo items during complex workflows. The tool replaces the entire todo list, so always include all current tasks (pending, in_progress, and completed). Mark tasks as in_progress when starting them, and completed when done. Only one task should be in_progress at a time.',
        inputSchema: TodoWriteInputSchema,

        execute: async (input: unknown, context?: ToolExecutionContext): Promise<unknown> => {
            // Validate input against schema
            const validatedInput = TodoWriteInputSchema.parse(input);

            // Use session_id from context, otherwise default
            const sessionId = context?.sessionId ?? 'default';

            // Update todos in todo service
            const result = await todoService.updateTodos(sessionId, validatedInput.todos);

            return {
                todos: result.todos,
                session_id: sessionId,
                stats: {
                    created: result.created,
                    updated: result.updated,
                    deleted: result.deleted,
                    total: result.todos.length,
                },
            };
        },
    };
}
