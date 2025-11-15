import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TodoService } from './todo-service.js';
import { TodoError } from './errors.js';
import { TodoErrorCode } from './error-codes.js';
import type { Database } from '../storage/database/types.js';
import type { AgentEventBus } from '../events/index.js';
import type { Todo, TodoInput } from './types.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

describe('TodoService', () => {
    let todoService: TodoService;
    let mockDatabase: Database;
    let mockEventBus: AgentEventBus;
    let emittedEvents: Array<{ event: string; payload: any }>;

    beforeEach(() => {
        vi.resetAllMocks();
        emittedEvents = [];

        // Mock database
        mockDatabase = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            append: vi.fn().mockResolvedValue(undefined),
            getRange: vi.fn().mockResolvedValue([]),
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            isConnected: vi.fn().mockReturnValue(true),
            getStoreType: vi.fn().mockReturnValue('memory'),
        };

        // Mock event bus
        mockEventBus = {
            emit: vi.fn((event: string, payload: any) => {
                emittedEvents.push({ event, payload });
            }),
            on: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            removeAllListeners: vi.fn(),
        } as any;

        todoService = new TodoService(mockDatabase, mockEventBus);
    });

    describe('initialization', () => {
        test('should initialize successfully', async () => {
            await todoService.initialize();
            expect(mockDatabase.isConnected).toBeDefined();
        });

        test('should not re-initialize if already initialized', async () => {
            await todoService.initialize();
            await todoService.initialize();
            // Should not throw
        });

        test('should throw if operations called before initialization', async () => {
            const input: TodoInput[] = [
                { content: 'Test', activeForm: 'Testing', status: 'pending' },
            ];

            await expect(todoService.updateTodos('session-1', input)).rejects.toMatchObject({
                code: TodoErrorCode.SERVICE_NOT_INITIALIZED,
                scope: 'todo',
                type: 'system',
            });
        });
    });

    describe('updateTodos', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should create new todos', async () => {
            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
                { content: 'Task 2', activeForm: 'Doing task 2', status: 'in_progress' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.created).toBe(2);
            expect(result.updated).toBe(0);
            expect(result.deleted).toBe(0);
            expect(result.todos).toHaveLength(2);
            expect(result.todos[0]).toMatchObject({
                content: 'Task 1',
                activeForm: 'Doing task 1',
                status: 'pending',
                position: 0,
            });
            expect(result.todos[0]?.id).toBeDefined();
            expect(result.todos[0]?.createdAt).toBeInstanceOf(Date);
        });

        test('should update existing todos', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'Task 1',
                    activeForm: 'Doing task 1',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'completed' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(1);
            expect(result.deleted).toBe(0);
            expect(result.todos[0]?.status).toBe('completed');
            expect(result.todos[0]?.id).toBe('todo-1');
        });

        test('should delete missing todos', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'Task 1',
                    activeForm: 'Doing task 1',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
                {
                    id: 'todo-2',
                    sessionId: 'session-1',
                    content: 'Task 2',
                    activeForm: 'Doing task 2',
                    status: 'pending',
                    position: 1,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            // Only include Task 1 in update
            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'completed' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(1);
            expect(result.deleted).toBe(1); // Task 2 was deleted
            expect(result.todos).toHaveLength(1);
        });

        test('should handle mixed create/update/delete', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'Keep',
                    activeForm: 'Keeping',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
                {
                    id: 'todo-2',
                    sessionId: 'session-1',
                    content: 'Delete',
                    activeForm: 'Deleting',
                    status: 'pending',
                    position: 1,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            const input: TodoInput[] = [
                { content: 'Keep', activeForm: 'Keeping', status: 'completed' }, // Update
                { content: 'New', activeForm: 'Creating new', status: 'pending' }, // Create
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.created).toBe(1);
            expect(result.updated).toBe(1);
            expect(result.deleted).toBe(1);
            expect(result.todos).toHaveLength(2);
        });

        test('should emit todo:updated event', async () => {
            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
            ];

            await todoService.updateTodos('session-1', input);

            expect(emittedEvents).toHaveLength(1);
            expect(emittedEvents[0]?.event).toBe('todo:updated');
            expect(emittedEvents[0]?.payload).toMatchObject({
                sessionId: 'session-1',
                stats: {
                    created: 1,
                    updated: 0,
                    deleted: 0,
                },
            });
            expect(emittedEvents[0]?.payload.todos).toHaveLength(1);
        });

        test('should not emit events when disabled', async () => {
            todoService = new TodoService(mockDatabase, mockEventBus, { enableEvents: false });
            await todoService.initialize();

            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
            ];

            await todoService.updateTodos('session-1', input);

            expect(emittedEvents).toHaveLength(0);
        });

        test('should enforce todo limit', async () => {
            todoService = new TodoService(mockDatabase, mockEventBus, { maxTodosPerSession: 2 });
            await todoService.initialize();

            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
                { content: 'Task 2', activeForm: 'Doing task 2', status: 'pending' },
                { content: 'Task 3', activeForm: 'Doing task 3', status: 'pending' },
            ];

            await expect(todoService.updateTodos('session-1', input)).rejects.toMatchObject({
                code: TodoErrorCode.TODO_LIMIT_EXCEEDED,
                scope: 'todo',
                type: 'user',
            });
        });

        test('should validate todo status', async () => {
            const input = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'invalid' as any },
            ];

            await expect(todoService.updateTodos('session-1', input)).rejects.toMatchObject({
                code: TodoErrorCode.INVALID_TODO_STATUS,
                scope: 'todo',
                type: 'user',
            });
        });

        test('should save todos to database with correct key', async () => {
            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
            ];

            await todoService.updateTodos('session-1', input);

            expect(mockDatabase.set).toHaveBeenCalledWith(
                'todos:session-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        content: 'Task 1',
                        activeForm: 'Doing task 1',
                        status: 'pending',
                    }),
                ])
            );
        });

        test('should handle database errors gracefully', async () => {
            vi.mocked(mockDatabase.set).mockRejectedValue(new Error('Database error'));

            const input: TodoInput[] = [
                { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' },
            ];

            await expect(todoService.updateTodos('session-1', input)).rejects.toMatchObject({
                code: TodoErrorCode.DATABASE_ERROR,
                scope: 'todo',
                type: 'system',
            });
        });
    });

    describe('getTodos', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should return empty array when no todos exist', async () => {
            vi.mocked(mockDatabase.get).mockResolvedValue(null);

            const todos = await todoService.getTodos('session-1');

            expect(todos).toEqual([]);
        });

        test('should return existing todos', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'Task 1',
                    activeForm: 'Doing task 1',
                    status: 'completed',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-02'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            const todos = await todoService.getTodos('session-1');

            expect(todos).toEqual(existingTodos);
            expect(mockDatabase.get).toHaveBeenCalledWith('todos:session-1');
        });

        test('should throw if not initialized', async () => {
            const uninitializedService = new TodoService(mockDatabase, mockEventBus);

            await expect(uninitializedService.getTodos('session-1')).rejects.toMatchObject({
                code: TodoErrorCode.SERVICE_NOT_INITIALIZED,
                scope: 'todo',
                type: 'system',
            });
        });

        test('should handle database errors', async () => {
            vi.mocked(mockDatabase.get).mockRejectedValue(new Error('Read error'));

            await expect(todoService.getTodos('session-1')).rejects.toMatchObject({
                code: TodoErrorCode.DATABASE_ERROR,
                scope: 'todo',
                type: 'system',
            });
        });
    });

    describe('todo matching and identity', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should match todos by content and activeForm', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'stable-id',
                    sessionId: 'session-1',
                    content: 'Fix bug',
                    activeForm: 'Fixing bug',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            // Same content and activeForm, different status
            const input: TodoInput[] = [
                { content: 'Fix bug', activeForm: 'Fixing bug', status: 'in_progress' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.updated).toBe(1);
            expect(result.created).toBe(0);
            expect(result.todos[0]?.id).toBe('stable-id'); // ID preserved
            expect(result.todos[0]?.status).toBe('in_progress');
        });

        test('should treat different activeForm as new todo', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'Fix bug',
                    activeForm: 'Fixing bug',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            const input: TodoInput[] = [
                { content: 'Fix bug', activeForm: 'Resolving bug', status: 'pending' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.created).toBe(1);
            expect(result.updated).toBe(0);
            expect(result.deleted).toBe(1);
        });
    });

    describe('position tracking', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should assign correct positions to new todos', async () => {
            const input: TodoInput[] = [
                { content: 'First', activeForm: 'First task', status: 'pending' },
                { content: 'Second', activeForm: 'Second task', status: 'pending' },
                { content: 'Third', activeForm: 'Third task', status: 'pending' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.todos[0]?.position).toBe(0);
            expect(result.todos[1]?.position).toBe(1);
            expect(result.todos[2]?.position).toBe(2);
        });

        test('should update positions when todos are reordered', async () => {
            const existingTodos: Todo[] = [
                {
                    id: 'todo-1',
                    sessionId: 'session-1',
                    content: 'First',
                    activeForm: 'First task',
                    status: 'pending',
                    position: 0,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
                {
                    id: 'todo-2',
                    sessionId: 'session-1',
                    content: 'Second',
                    activeForm: 'Second task',
                    status: 'pending',
                    position: 1,
                    createdAt: new Date('2024-01-01'),
                    updatedAt: new Date('2024-01-01'),
                },
            ];

            vi.mocked(mockDatabase.get).mockResolvedValue(existingTodos);

            // Reverse order
            const input: TodoInput[] = [
                { content: 'Second', activeForm: 'Second task', status: 'pending' },
                { content: 'First', activeForm: 'First task', status: 'pending' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.todos[0]?.content).toBe('Second');
            expect(result.todos[0]?.position).toBe(0);
            expect(result.todos[1]?.content).toBe('First');
            expect(result.todos[1]?.position).toBe(1);
        });
    });

    describe('status validation', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should accept valid statuses', async () => {
            const input: TodoInput[] = [
                { content: 'Pending', activeForm: 'Pending task', status: 'pending' },
                { content: 'In Progress', activeForm: 'Working', status: 'in_progress' },
                { content: 'Completed', activeForm: 'Done', status: 'completed' },
            ];

            const result = await todoService.updateTodos('session-1', input);

            expect(result.todos).toHaveLength(3);
            expect(result.todos[0]?.status).toBe('pending');
            expect(result.todos[1]?.status).toBe('in_progress');
            expect(result.todos[2]?.status).toBe('completed');
        });

        test('should reject invalid status', async () => {
            const input = [{ content: 'Task', activeForm: 'Tasking', status: 'running' as any }];

            await expect(todoService.updateTodos('session-1', input)).rejects.toMatchObject({
                code: TodoErrorCode.INVALID_TODO_STATUS,
                scope: 'todo',
                type: 'user',
            });
        });
    });

    describe('error handling', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should validate error codes', async () => {
            const input = [{ content: 'Task', activeForm: 'Tasking', status: 'invalid' as any }];

            try {
                await todoService.updateTodos('session-1', input);
                expect.fail('Should have thrown');
            } catch (error: any) {
                expect(error.code).toBe(TodoErrorCode.INVALID_TODO_STATUS);
                expect(error.scope).toBe('todo');
                expect(error.type).toBe('user');
            }
        });

        test('should preserve DextoRuntimeError instances', async () => {
            const customError = TodoError.todoLimitExceeded(5, 3);
            vi.mocked(mockDatabase.get).mockRejectedValue(customError);

            await expect(todoService.getTodos('session-1')).rejects.toThrow(customError);
        });
    });

    describe('session isolation', () => {
        beforeEach(async () => {
            await todoService.initialize();
        });

        test('should isolate todos by session', async () => {
            const input1: TodoInput[] = [
                { content: 'Session 1 Task', activeForm: 'Working', status: 'pending' },
            ];
            const input2: TodoInput[] = [
                { content: 'Session 2 Task', activeForm: 'Working', status: 'pending' },
            ];

            await todoService.updateTodos('session-1', input1);
            await todoService.updateTodos('session-2', input2);

            expect(mockDatabase.set).toHaveBeenCalledWith('todos:session-1', expect.any(Array));
            expect(mockDatabase.set).toHaveBeenCalledWith('todos:session-2', expect.any(Array));
        });
    });
});
