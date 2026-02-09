/**
 * Todo Service
 *
 * Manages todo lists for tracking agent workflow and task progress.
 * Emits events through the AgentEventBus using the service:event pattern.
 */

import { nanoid } from 'nanoid';
import type { Database, AgentEventBus, IDextoLogger } from '@dexto/core';
import { DextoRuntimeError } from '@dexto/core';
import { TodoError } from './errors.js';
import type { Todo, TodoInput, TodoUpdateResult, TodoConfig, TodoStatus } from './types.js';
import { TODO_STATUS_VALUES } from './types.js';

const DEFAULT_MAX_TODOS = 100;
const TODOS_KEY_PREFIX = 'todos:';

type TodoEventEmitter = Pick<AgentEventBus, 'emit'>;

/**
 * TodoService - Manages todo lists for agent workflow tracking
 */
export class TodoService {
    private database: Database;
    private eventBus: TodoEventEmitter;
    private logger: IDextoLogger;
    private config: Required<TodoConfig>;
    private initialized: boolean = false;

    constructor(
        database: Database,
        eventBus: TodoEventEmitter,
        logger: IDextoLogger,
        config: TodoConfig = {}
    ) {
        this.database = database;
        this.eventBus = eventBus;
        this.logger = logger;
        this.config = {
            maxTodosPerSession: config.maxTodosPerSession ?? DEFAULT_MAX_TODOS,
            enableEvents: config.enableEvents ?? true,
        };
    }

    /**
     * Initialize the service
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            this.logger.debug('TodoService already initialized');
            return;
        }

        this.initialized = true;
        this.logger.info('TodoService initialized successfully');
    }

    /**
     * Update todos for a session (replaces entire list)
     */
    async updateTodos(sessionId: string, todoInputs: TodoInput[]): Promise<TodoUpdateResult> {
        if (!this.initialized) {
            throw TodoError.notInitialized();
        }

        // Validate todo count
        if (todoInputs.length > this.config.maxTodosPerSession) {
            throw TodoError.todoLimitExceeded(todoInputs.length, this.config.maxTodosPerSession);
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

            // Emit event using the service:event pattern
            if (this.config.enableEvents) {
                this.eventBus.emit('service:event', {
                    service: 'todo',
                    event: 'updated',
                    sessionId,
                    data: {
                        todos: newTodos,
                        stats,
                    },
                });
            }

            this.logger.debug(
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
            throw TodoError.databaseError(
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
            throw TodoError.notInitialized();
        }

        try {
            const key = this.getTodosDatabaseKey(sessionId);
            const todos = await this.database.get<Todo[]>(key);
            return todos || [];
        } catch (error) {
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw TodoError.databaseError(
                'getTodos',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Generate database key for session todos
     */
    private getTodosDatabaseKey(sessionId: string): string {
        return `${TODOS_KEY_PREFIX}${sessionId}`;
    }

    /**
     * Generate consistent key for todo matching (content + activeForm)
     * Uses JSON encoding to prevent collisions when fields contain delimiters
     */
    private getTodoKey(todo: Todo | TodoInput): string {
        return JSON.stringify([todo.content, todo.activeForm]);
    }

    /**
     * Generate key from TodoInput
     * Uses JSON encoding to prevent collisions when fields contain delimiters
     */
    private getTodoKeyFromInput(input: TodoInput): string {
        return JSON.stringify([input.content, input.activeForm]);
    }

    /**
     * Validate todo status
     */
    private validateTodoStatus(status: TodoStatus): void {
        if (!TODO_STATUS_VALUES.includes(status)) {
            throw TodoError.invalidStatus(status);
        }
    }
}
