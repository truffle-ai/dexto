import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { TodoService } from './todo-service.js';
import { createTodoWriteTool, type TodoServiceGetter } from './todo-write-tool.js';
import { TodoToolsConfigSchema, type TodoToolsConfig } from './tool-factory-config.js';

export const todoToolsFactory: ToolFactory<TodoToolsConfig> = {
    configSchema: TodoToolsConfigSchema,
    metadata: {
        displayName: 'Todo Tools',
        description: 'Task tracking and workflow management (todo_write)',
        category: 'workflow',
    },
    create: (config) => {
        let todoService: TodoService | undefined;

        const getTodoService: TodoServiceGetter = async (context?: ToolExecutionContext) => {
            if (todoService) {
                return todoService;
            }

            const logger = context?.logger;
            if (!logger) {
                throw new Error(
                    'todo-tools requires ToolExecutionContext.logger (ToolManager should provide this)'
                );
            }

            const database = context?.storage?.database;
            if (!database) {
                throw new Error(
                    'todo-tools requires ToolExecutionContext.storage.database (ToolManager should provide this)'
                );
            }

            const agent = context?.agent;
            if (!agent) {
                throw new Error(
                    'todo-tools requires ToolExecutionContext.agent (ToolManager should provide this)'
                );
            }

            todoService = new TodoService(database, agent, logger, {
                maxTodosPerSession: config.maxTodosPerSession,
                enableEvents: config.enableEvents,
            });

            return todoService;
        };

        return [createTodoWriteTool(getTodoService)];
    },
};
