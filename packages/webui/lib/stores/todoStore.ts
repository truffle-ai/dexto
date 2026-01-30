/**
 * Todo Store
 *
 * Manages todo/task state for agent workflow tracking.
 * State is per-session and not persisted (todos come from server events).
 */

import { create } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Todo status
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Todo item
 */
export interface Todo {
    id: string;
    sessionId: string;
    content: string;
    activeForm: string;
    status: TodoStatus;
    position: number;
    createdAt: Date | string;
    updatedAt: Date | string;
}

/**
 * State per session
 */
interface SessionTodoState {
    todos: Todo[];
}

// =============================================================================
// Store Interface
// =============================================================================

interface TodoStore {
    /**
     * Todo state by session ID
     */
    sessions: Map<string, SessionTodoState>;

    /**
     * Get todos for a session
     */
    getTodos: (sessionId: string) => Todo[];

    /**
     * Update todos for a session (replaces entire list)
     */
    setTodos: (sessionId: string, todos: Todo[]) => void;

    /**
     * Clear todos for a session
     */
    clearTodos: (sessionId: string) => void;
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useTodoStore = create<TodoStore>()((set, get) => ({
    sessions: new Map(),

    getTodos: (sessionId: string): Todo[] => {
        return get().sessions.get(sessionId)?.todos ?? [];
    },

    setTodos: (sessionId: string, todos: Todo[]): void => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            newSessions.set(sessionId, { todos });
            return { sessions: newSessions };
        });
    },

    clearTodos: (sessionId: string): void => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            newSessions.delete(sessionId);
            return { sessions: newSessions };
        });
    },
}));
