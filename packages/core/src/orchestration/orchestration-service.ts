/**
 * Orchestration Service
 *
 * Manages todo lists for tracking agent workflow and task progress
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
} from './types.js';

const DEFAULT_MAX_TODOS = 100;
const TODOS_KEY_PREFIX = 'todos:';

/**
 * OrchestrationService - Manages todo lists for agent workflow tracking
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
}
