/**
 * TodoService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TodoService } from './todo-service.js';
import type { Database, AgentEventBus, IDextoLogger } from '@dexto/core';
import type { TodoInput } from './types.js';

// Mock database
function createMockDatabase(): Database {
    const store = new Map<string, unknown>();
    return {
        get: vi.fn().mockImplementation(async (key: string) => store.get(key)),
        set: vi.fn().mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value);
        }),
        delete: vi.fn().mockImplementation(async (key: string) => {
            store.delete(key);
        }),
        list: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        getRange: vi.fn().mockResolvedValue([]),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        getStoreType: vi.fn().mockReturnValue('mock'),
    } as Database;
}

// Mock event bus
function createMockEventBus(): AgentEventBus {
    return {
        emit: vi.fn(),
        on: vi.fn().mockReturnThis(),
        once: vi.fn().mockReturnThis(),
        off: vi.fn().mockReturnThis(),
    } as unknown as AgentEventBus;
}

// Mock logger
function createMockLogger(): IDextoLogger {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => createMockLogger()),
        level: 'info',
        silent: false,
    } as unknown as IDextoLogger;
}

describe('TodoService', () => {
    let service: TodoService;
    let mockDb: Database;
    let mockEventBus: AgentEventBus;
    let mockLogger: IDextoLogger;

    beforeEach(async () => {
        mockDb = createMockDatabase();
        mockEventBus = createMockEventBus();
        mockLogger = createMockLogger();

        service = new TodoService(mockDb, mockEventBus, mockLogger);
        await service.initialize();
    });

    describe('initialize', () => {
        it('should initialize successfully', async () => {
            const newService = new TodoService(mockDb, mockEventBus, mockLogger);
            await expect(newService.initialize()).resolves.not.toThrow();
        });

        it('should be idempotent', async () => {
            await expect(service.initialize()).resolves.not.toThrow();
        });
    });

    describe('updateTodos', () => {
        const sessionId = 'test-session';

        it('should create new todos', async () => {
            const todoInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
                { content: 'Task 2', activeForm: 'Working on Task 2', status: 'in_progress' },
            ];

            const result = await service.updateTodos(sessionId, todoInputs);

            expect(result.todos).toHaveLength(2);
            expect(result.created).toBe(2);
            expect(result.updated).toBe(0);
            expect(result.deleted).toBe(0);
            expect(result.todos[0]?.content).toBe('Task 1');
            expect(result.todos[1]?.content).toBe('Task 2');
        });

        it('should preserve existing todo IDs when updating', async () => {
            // Create initial todos
            const initialInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
            ];
            const initialResult = await service.updateTodos(sessionId, initialInputs);
            const originalId = initialResult.todos[0]?.id;

            // Update with same content but different status
            const updatedInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'completed' },
            ];
            const updatedResult = await service.updateTodos(sessionId, updatedInputs);

            expect(updatedResult.todos[0]?.id).toBe(originalId);
            expect(updatedResult.todos[0]?.status).toBe('completed');
            expect(updatedResult.updated).toBe(1);
            expect(updatedResult.created).toBe(0);
        });

        it('should track deleted todos', async () => {
            // Create initial todos
            const initialInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
                { content: 'Task 2', activeForm: 'Working on Task 2', status: 'pending' },
            ];
            await service.updateTodos(sessionId, initialInputs);

            // Update with only one todo
            const updatedInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'completed' },
            ];
            const result = await service.updateTodos(sessionId, updatedInputs);

            expect(result.todos).toHaveLength(1);
            expect(result.deleted).toBe(1);
        });

        it('should emit service:event when todos are updated', async () => {
            const todoInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
            ];

            await service.updateTodos(sessionId, todoInputs);

            expect(mockEventBus.emit).toHaveBeenCalledWith('service:event', {
                service: 'todo',
                event: 'updated',
                sessionId,
                data: expect.objectContaining({
                    todos: expect.any(Array),
                    stats: expect.objectContaining({
                        created: 1,
                        updated: 0,
                        deleted: 0,
                    }),
                }),
            });
        });

        it('should respect maxTodosPerSession limit', async () => {
            const limitedService = new TodoService(mockDb, mockEventBus, mockLogger, {
                maxTodosPerSession: 2,
            });
            await limitedService.initialize();

            const todoInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
                { content: 'Task 2', activeForm: 'Working on Task 2', status: 'pending' },
                { content: 'Task 3', activeForm: 'Working on Task 3', status: 'pending' },
            ];

            await expect(limitedService.updateTodos(sessionId, todoInputs)).rejects.toThrow(
                /Todo limit exceeded/
            );
        });

        it('should not emit events when enableEvents is false', async () => {
            const silentService = new TodoService(mockDb, mockEventBus, mockLogger, {
                enableEvents: false,
            });
            await silentService.initialize();

            const todoInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
            ];

            await silentService.updateTodos(sessionId, todoInputs);

            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });
    });

    describe('getTodos', () => {
        const sessionId = 'test-session';

        it('should return empty array for new session', async () => {
            const todos = await service.getTodos(sessionId);
            expect(todos).toEqual([]);
        });

        it('should return todos after update', async () => {
            const todoInputs: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Working on Task 1', status: 'pending' },
            ];
            await service.updateTodos(sessionId, todoInputs);

            const todos = await service.getTodos(sessionId);
            expect(todos).toHaveLength(1);
            expect(todos[0]?.content).toBe('Task 1');
        });
    });

    describe('error handling', () => {
        it('should throw if not initialized', async () => {
            const uninitService = new TodoService(mockDb, mockEventBus, mockLogger);

            await expect(uninitService.getTodos('session')).rejects.toThrow(/not been initialized/);
            await expect(uninitService.updateTodos('session', [])).rejects.toThrow(
                /not been initialized/
            );
        });
    });
});
