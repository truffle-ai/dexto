/**
 * Orchestration Service
 *
 * Handles task management, todo lists, and workflow orchestration
 */

import { nanoid } from 'nanoid';
import type { Database } from '../storage/database/types.js';
import type { AgentEventBus } from '../events/index.js';
import { logger } from '../logger/index.js';
import { OrchestrationError } from './errors.js';
import { DextoRuntimeError } from '../errors/index.js';
import type {
    Todo,
    TodoInput,
    TodoUpdateResult,
    OrchestrationConfig,
    TodoStatus,
    SpawnedTask,
    SpawnTaskInput,
    SpawnTaskResult,
    SpawnedTaskStatus,
} from './types.js';

const DEFAULT_MAX_TODOS = 100;
const DEFAULT_MAX_SPAWNED_TASKS = 50;
const TODOS_KEY_PREFIX = 'todos:';
const SPAWNED_TASKS_KEY_PREFIX = 'spawned_tasks:';
const TASK_SESSION_INDEX_PREFIX = 'task_session_index:';

/**
 * OrchestrationService - Manages todos and task orchestration
 */
export class OrchestrationService {
    private database: Database;
    private eventBus: AgentEventBus;
    private config: Required<OrchestrationConfig>;
    private initialized: boolean = false;

    constructor(database: Database, eventBus: AgentEventBus, config: OrchestrationConfig = {}) {
        this.database = database;
        this.eventBus = eventBus;
        this.config = {
            maxTodosPerSession: config.maxTodosPerSession ?? DEFAULT_MAX_TODOS,
            maxSpawnedTasksPerSession:
                config.maxSpawnedTasksPerSession ?? DEFAULT_MAX_SPAWNED_TASKS,
            enableEvents: config.enableEvents ?? true,
        };
    }

    /**
     * Initialize the service
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug('OrchestrationService already initialized');
            return;
        }

        this.initialized = true;
        logger.info('OrchestrationService initialized successfully');
    }

    /**
     * Update todos for a session (replaces entire list)
     */
    async updateTodos(sessionId: string, todoInputs: TodoInput[]): Promise<TodoUpdateResult> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        // Validate todo count
        if (todoInputs.length > this.config.maxTodosPerSession) {
            throw OrchestrationError.todoLimitExceeded(
                todoInputs.length,
                this.config.maxTodosPerSession
            );
        }

        try {
            // Get existing todos
            const existing = await this.getTodos(sessionId);
            const existingMap = new Map(existing.map((t) => [this.getTodoKey(t), t]));

            // Create new todos with IDs
            const now = new Date();
            const newTodos: Todo[] = [];
            const stats = { created: 0, updated: 0, deleted: 0 };

            for (let i = 0; i < todoInputs.length; i++) {
                const input = todoInputs[i]!;
                this.validateTodoStatus(input.status);

                // Generate consistent key for matching
                const todoKey = this.getTodoKeyFromInput(input);
                const existingTodo = existingMap.get(todoKey);

                if (existingTodo) {
                    // Update existing todo
                    const updated: Todo = {
                        ...existingTodo,
                        status: input.status,
                        updatedAt: now,
                        position: i,
                    };
                    newTodos.push(updated);
                    stats.updated++;
                    existingMap.delete(todoKey);
                } else {
                    // Create new todo
                    const created: Todo = {
                        id: nanoid(),
                        sessionId,
                        content: input.content,
                        activeForm: input.activeForm,
                        status: input.status,
                        position: i,
                        createdAt: now,
                        updatedAt: now,
                    };
                    newTodos.push(created);
                    stats.created++;
                }
            }

            // Remaining items in existingMap are deleted
            stats.deleted = existingMap.size;

            // Save to database
            const key = this.getTodosDatabaseKey(sessionId);
            await this.database.set(key, newTodos);

            // Emit event
            if (this.config.enableEvents) {
                this.eventBus.emit('todo:updated', {
                    sessionId,
                    todos: newTodos,
                    stats,
                });
            }

            logger.debug(
                `Updated todos for session ${sessionId}: ${stats.created} created, ${stats.updated} updated, ${stats.deleted} deleted`
            );

            return {
                todos: newTodos,
                sessionId,
                ...stats,
            };
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'updateTodos',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Get todos for a session
     */
    async getTodos(sessionId: string): Promise<Todo[]> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            const key = this.getTodosDatabaseKey(sessionId);
            const todos = await this.database.get<Todo[]>(key);
            return todos || [];
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'getTodos',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Clear all todos for a session
     */
    async clearTodos(sessionId: string): Promise<void> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            const key = this.getTodosDatabaseKey(sessionId);
            await this.database.delete(key);

            if (this.config.enableEvents) {
                this.eventBus.emit('todo:cleared', { sessionId });
            }

            logger.debug(`Cleared todos for session ${sessionId}`);
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'clearTodos',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * List all sessions with todos
     */
    async listSessions(): Promise<string[]> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            const keys = await this.database.list(TODOS_KEY_PREFIX);
            return keys.map((key) => key.replace(TODOS_KEY_PREFIX, ''));
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'listSessions',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Spawn a new sub-agent task
     */
    async spawnTask(sessionId: string, input: SpawnTaskInput): Promise<SpawnTaskResult> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            // Check current task count for session
            const existingTasks = await this.getSpawnedTasks(sessionId);
            const activeTasks = existingTasks.filter(
                (t) => t.status === 'pending' || t.status === 'in_progress'
            );

            if (activeTasks.length >= this.config.maxSpawnedTasksPerSession) {
                throw OrchestrationError.taskLimitExceeded(
                    activeTasks.length,
                    this.config.maxSpawnedTasksPerSession
                );
            }

            // Create new task
            const now = new Date();
            const taskId = nanoid();
            const task: SpawnedTask = {
                id: taskId,
                sessionId,
                prompt: input.prompt,
                ...(input.description ? { description: input.description } : {}),
                status: 'pending',
                createdAt: now,
                updatedAt: now,
            };

            // Save task
            const taskKey = this.getSpawnedTaskDatabaseKey(taskId);
            await this.database.set(taskKey, task);

            // Update session index
            const indexKey = this.getTaskSessionIndexKey(sessionId);
            const sessionTaskIds = (await this.database.get<string[]>(indexKey)) || [];
            sessionTaskIds.push(taskId);
            await this.database.set(indexKey, sessionTaskIds);

            // Emit event
            if (this.config.enableEvents) {
                const eventData: {
                    sessionId: string;
                    taskId: string;
                    prompt: string;
                    description?: string;
                } = {
                    sessionId,
                    taskId,
                    prompt: input.prompt,
                    ...(input.description ? { description: input.description } : {}),
                };
                this.eventBus.emit('task:spawned', eventData);
            }

            logger.debug(`Spawned task ${taskId} for session ${sessionId}`);

            const result: SpawnTaskResult = {
                taskId,
                sessionId,
                prompt: task.prompt,
                ...(task.description ? { description: task.description } : {}),
                status: task.status,
            };

            return result;
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.taskCreateFailed(
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Get all spawned tasks for a session
     */
    async getSpawnedTasks(sessionId: string): Promise<SpawnedTask[]> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            const indexKey = this.getTaskSessionIndexKey(sessionId);
            const taskIds = (await this.database.get<string[]>(indexKey)) || [];

            const tasks: SpawnedTask[] = [];
            for (const taskId of taskIds) {
                const taskKey = this.getSpawnedTaskDatabaseKey(taskId);
                const task = await this.database.get<SpawnedTask>(taskKey);
                if (task) {
                    tasks.push(task);
                }
            }

            return tasks;
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'getSpawnedTasks',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Get a specific spawned task
     */
    async getSpawnedTask(taskId: string): Promise<SpawnedTask | null> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        try {
            const taskKey = this.getSpawnedTaskDatabaseKey(taskId);
            const task = await this.database.get<SpawnedTask>(taskKey);
            return task || null;
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.databaseError(
                'getSpawnedTask',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Update a spawned task
     */
    async updateSpawnedTask(
        taskId: string,
        status: SpawnedTaskStatus,
        result?: string,
        error?: string
    ): Promise<void> {
        if (!this.initialized) {
            throw OrchestrationError.notInitialized();
        }

        this.validateTaskStatus(status);

        try {
            const task = await this.getSpawnedTask(taskId);
            if (!task) {
                throw OrchestrationError.taskNotFound(taskId);
            }

            const now = new Date();
            const completedAt =
                status === 'completed' || status === 'failed' ? now : task.completedAt;

            const updatedTask: SpawnedTask = {
                ...task,
                status,
                ...(result ? { result } : {}),
                ...(error ? { error } : {}),
                updatedAt: now,
                ...(completedAt ? { completedAt } : {}),
            };

            const taskKey = this.getSpawnedTaskDatabaseKey(taskId);
            await this.database.set(taskKey, updatedTask);

            // Emit event
            if (this.config.enableEvents) {
                const eventData: {
                    taskId: string;
                    sessionId: string;
                    status: SpawnedTaskStatus;
                    result?: string;
                    error?: string;
                } = {
                    taskId,
                    sessionId: task.sessionId,
                    status,
                    ...(result ? { result } : {}),
                    ...(error ? { error } : {}),
                };
                this.eventBus.emit('task:updated', eventData);
            }

            logger.debug(`Updated spawned task ${taskId} to status: ${status}`);
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw OrchestrationError.taskUpdateFailed(
                taskId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Get configuration
     */
    getConfig(): Readonly<Required<OrchestrationConfig>> {
        return { ...this.config };
    }

    /**
     * Generate database key for session todos
     */
    private getTodosDatabaseKey(sessionId: string): string {
        return `${TODOS_KEY_PREFIX}${sessionId}`;
    }

    /**
     * Generate consistent key for todo matching (content + activeForm)
     */
    private getTodoKey(todo: Todo | TodoInput): string {
        return `${todo.content}|${todo.activeForm}`;
    }

    /**
     * Generate key from TodoInput
     */
    private getTodoKeyFromInput(input: TodoInput): string {
        return `${input.content}|${input.activeForm}`;
    }

    /**
     * Validate todo status
     */
    private validateTodoStatus(status: TodoStatus): void {
        const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'completed'];
        if (!validStatuses.includes(status)) {
            throw OrchestrationError.invalidStatus(status);
        }
    }

    /**
     * Generate database key for spawned task
     */
    private getSpawnedTaskDatabaseKey(taskId: string): string {
        return `${SPAWNED_TASKS_KEY_PREFIX}${taskId}`;
    }

    /**
     * Generate database key for session task index
     */
    private getTaskSessionIndexKey(sessionId: string): string {
        return `${TASK_SESSION_INDEX_PREFIX}${sessionId}`;
    }

    /**
     * Validate spawned task status
     */
    private validateTaskStatus(status: SpawnedTaskStatus): void {
        const validStatuses: SpawnedTaskStatus[] = [
            'pending',
            'in_progress',
            'completed',
            'failed',
        ];
        if (!validStatuses.includes(status)) {
            throw OrchestrationError.invalidTaskStatus(status);
        }
    }
}
