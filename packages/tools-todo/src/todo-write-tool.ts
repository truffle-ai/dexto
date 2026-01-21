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
const TodoItemSchema = z
    .object({
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
    })
    .strict();

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
    .superRefine((value, ctx) => {
        const inProgressCount = value.todos.filter((todo) => todo.status === 'in_progress').length;
        if (inProgressCount > 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Only one todo may be in_progress at a time.',
                path: ['todos'],
            });
        }
    })
    .describe(
        'Manage task list for current session. Replaces the entire todo list with the provided tasks.'
    );

/**
 * Create todo_write internal tool
 */
export function createTodoWriteTool(todoService: TodoService): InternalTool {
    return {
        id: 'todo_write',
        description: `Track progress on multi-step tasks. Use for:
- Implementation tasks with 3+ steps (features, refactors, bug fixes)
- Tasks where the user asks for a plan or breakdown
- Complex workflows where progress visibility helps

Do NOT use for simple single-file edits, quick questions, or explanations.

IMPORTANT: This replaces the entire todo list. Always include ALL tasks (pending, in_progress, completed). Only ONE task should be in_progress at a time. Update status as you work: pending → in_progress → completed.`,
        inputSchema: TodoWriteInputSchema,

        execute: async (input: unknown, context?: ToolExecutionContext): Promise<unknown> => {
            // Validate input against schema
            const validatedInput = TodoWriteInputSchema.parse(input);

            // Use session_id from context, otherwise default
            const sessionId = context?.sessionId ?? 'default';

            // Update todos in todo service
            const result = await todoService.updateTodos(sessionId, validatedInput.todos);

            // Count by status for summary
            const completed = result.todos.filter((t) => t.status === 'completed').length;
            const inProgress = result.todos.filter((t) => t.status === 'in_progress').length;
            const pending = result.todos.filter((t) => t.status === 'pending').length;

            // Return simple summary - TodoPanel shows full state
            return `Updated tasks: ${completed}/${result.todos.length} completed${inProgress > 0 ? `, 1 in progress` : ''}${pending > 0 ? `, ${pending} pending` : ''}`;
        },
    };
}
