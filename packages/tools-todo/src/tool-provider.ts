/**
 * Todo Tools Provider
 *
 * Provides task tracking tools by wrapping TodoService.
 * When registered, the provider initializes TodoService and creates the
 * todo_write tool for managing task lists.
 */

import { z } from 'zod';

/**
 * Default configuration constants for Todo tools.
 */
const DEFAULT_MAX_TODOS_PER_SESSION = 100;
const DEFAULT_ENABLE_EVENTS = true;

/**
 * Configuration schema for Todo tools provider.
 */
export const TodoToolsConfigSchema = z
    .object({
        type: z.literal('todo-tools'),
        maxTodosPerSession: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_TODOS_PER_SESSION)
            .describe(`Maximum todos per session (default: ${DEFAULT_MAX_TODOS_PER_SESSION})`),
        enableEvents: z
            .boolean()
            .default(DEFAULT_ENABLE_EVENTS)
            .describe('Enable real-time events for todo updates'),
    })
    .strict();

export type TodoToolsConfig = z.output<typeof TodoToolsConfigSchema>;
