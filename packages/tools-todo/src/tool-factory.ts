import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';
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

        const getTodoService: TodoServiceGetter = async (context: ToolExecutionContext) => {
            if (todoService) {
                return todoService;
            }

            const logger = context.logger;
            const database = context.storage?.database;
            if (!database) {
                throw ToolError.configInvalid(
                    'todo-tools requires ToolExecutionContext.storage.database'
                );
            }

            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('todo-tools requires ToolExecutionContext.agent');
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
