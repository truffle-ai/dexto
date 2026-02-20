/**
 * Todo Write Tool
 *
 * Manages todo lists for tracking agent progress and workflow organization
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
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
        'Manage todo list for current session. Replaces the entire todo list with the provided items.'
    );

/**
 * Create todo_write internal tool
 */
export type TodoServiceGetter = (context: ToolExecutionContext) => Promise<TodoService>;

export function createTodoWriteTool(
    getTodoService: TodoServiceGetter
): Tool<typeof TodoWriteInputSchema> {
    return defineTool({
        id: 'todo_write',
        description: `Track progress on multi-step tasks. Use for:
- Implementation tasks with 3+ steps (features, refactors, bug fixes)
- Tasks where the user asks for a plan or breakdown
- Complex workflows where progress visibility helps

Do NOT use for simple single-file edits, quick questions, or explanations.

IMPORTANT: This replaces the entire todo list. Always include ALL tasks (pending, in_progress, completed). Only ONE task should be in_progress at a time. Update status as you work: pending → in_progress → completed.`,
        inputSchema: TodoWriteInputSchema,

        presentation: {
            displayName: 'Update Todos',
        },

        async execute(input, context: ToolExecutionContext): Promise<unknown> {
            const resolvedTodoService = await getTodoService(context);

            // Use session_id from context, otherwise default
            const sessionId = context.sessionId ?? 'default';

            // Update todos in todo service
            await resolvedTodoService.initialize();
            const result = await resolvedTodoService.updateTodos(sessionId, input.todos);

            // Count by status for summary
            const completed = result.todos.filter((t) => t.status === 'completed').length;
            const inProgress = result.todos.filter((t) => t.status === 'in_progress').length;
            const pending = result.todos.filter((t) => t.status === 'pending').length;

            // Return simple summary - TodoPanel shows full state
            return `Updated todos: ${completed}/${result.todos.length} completed${inProgress > 0 ? `, 1 in progress` : ''}${pending > 0 ? `, ${pending} pending` : ''}`;
        },
    });
}
