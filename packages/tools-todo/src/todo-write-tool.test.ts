import { describe, expect, it, vi } from 'vitest';
import { ToolErrorCode } from '@dexto/core';
import type { Logger, ToolExecutionContext } from '@dexto/core';
import type { TodoService } from './todo-service.js';
import { createTodoWriteTool, type TodoServiceGetter } from './todo-write-tool.js';

function createMockLogger(): Logger {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
}

function createToolContext(
    logger: Logger,
    overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
    return { logger, ...overrides };
}

describe('todo_write tool', () => {
    it('throws validation error when sessionId is missing', async () => {
        const logger = createMockLogger();
        const getTodoService = vi.fn<TodoServiceGetter>(async () => {
            throw new Error('todo service should not be requested without a session');
        });
        const tool = createTodoWriteTool(getTodoService);
        const input = tool.inputSchema.parse({
            todos: [{ content: 'Test task', activeForm: 'Testing task', status: 'pending' }],
        });

        await expect(tool.execute(input, createToolContext(logger))).rejects.toMatchObject({
            name: 'DextoRuntimeError',
            code: ToolErrorCode.VALIDATION_FAILED,
        });
        expect(getTodoService).not.toHaveBeenCalled();
    });

    it('updates todos for the current session', async () => {
        const logger = createMockLogger();
        const initialize = vi.fn().mockResolvedValue(undefined);
        const updateTodos = vi.fn().mockResolvedValue({
            todos: [
                {
                    id: 'todo-1',
                    sessionId: 'session-123',
                    content: 'Test task',
                    activeForm: 'Testing task',
                    status: 'in_progress',
                    position: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        });
        const getTodoService = vi.fn<TodoServiceGetter>().mockResolvedValue({
            initialize,
            updateTodos,
        } as unknown as TodoService);
        const tool = createTodoWriteTool(getTodoService);
        const input = tool.inputSchema.parse({
            todos: [{ content: 'Test task', activeForm: 'Testing task', status: 'in_progress' }],
        });

        const result = await tool.execute(
            input,
            createToolContext(logger, { sessionId: 'session-123' })
        );

        expect(getTodoService).toHaveBeenCalledOnce();
        expect(initialize).toHaveBeenCalledOnce();
        expect(updateTodos).toHaveBeenCalledWith('session-123', input.todos);
        expect(result).toBe('Updated todos: 0/1 completed, 1 in progress');
    });
});
