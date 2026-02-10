/**
 * Todo Tools Provider
 *
 * Provides task tracking tools by wrapping TodoService.
 * When registered, the provider initializes TodoService and creates the
 * todo_write tool for managing task lists.
 */

import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext, InternalTool } from '@dexto/core';
import { TodoService } from './todo-service.js';
import { createTodoWriteTool } from './todo-write-tool.js';

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

/**
 * Todo tools provider.
 *
 * Wraps TodoService and provides the todo_write tool for managing task lists.
 *
 * When registered via customToolRegistry, TodoService is automatically
 * initialized and the todo_write tool becomes available to the agent.
 */
export const todoToolsProvider: CustomToolProvider<'todo-tools', TodoToolsConfig> = {
    type: 'todo-tools',
    configSchema: TodoToolsConfigSchema,

    create: (config: TodoToolsConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger, agent, services } = context;

        logger.debug('Creating TodoService for todo tools');

        // Get required services from context
        const storageManager = services?.storageManager;
        if (!storageManager) {
            throw new Error(
                'TodoService requires storageManager service. Ensure it is available in ToolCreationContext.'
            );
        }

        const database = storageManager.getDatabase();

        // Create TodoService with validated config
        const todoService = new TodoService(database, agent, logger, {
            maxTodosPerSession: config.maxTodosPerSession,
            enableEvents: config.enableEvents,
        });

        // Start initialization in background
        todoService.initialize().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`TodoToolsProvider.create: Failed to initialize TodoService: ${message}`);
        });

        logger.debug('TodoService created - initialization will complete on first tool use');

        // Create and return the todo_write tool
        return [createTodoWriteTool(todoService)];
    },

    metadata: {
        displayName: 'Todo Tools',
        description: 'Task tracking and workflow management (todo_write)',
        category: 'workflow',
    },
};
