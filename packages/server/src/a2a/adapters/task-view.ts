/**
 * A2A TaskView Adapter
 *
 * Wraps a Dexto ChatSession to present it as an A2A Task.
 * This is a pure adapter - no storage, no persistence, just a view.
 *
 * Key principle: taskId === sessionId
 */

import type { ChatSession } from '@dexto/core';
import type { Task, TaskStatus } from '../types.js';
import { internalMessagesToA2A } from './message.js';
import { deriveTaskState } from './state.js';

/**
 * TaskView wraps a ChatSession to provide A2A-compliant task interface.
 *
 * This is a lightweight adapter that converts session state to A2A format
 * on-demand. No state is cached or stored.
 *
 * Usage:
 * ```typescript
 * const session = await agent.createSession(taskId);
 * const taskView = new TaskView(session);
 * const task = await taskView.toA2ATask();
 * ```
 */
export class TaskView {
    constructor(private session: ChatSession) {}

    /**
     * Convert the wrapped session to an A2A Task.
     *
     * This reads the session history and converts it to A2A format.
     * State is derived from message patterns, not stored separately.
     *
     * @returns A2A protocol task structure
     */
    async toA2ATask(): Promise<Task> {
        // Get session history
        const history = await this.session.getHistory();

        // Convert internal messages to A2A format
        const a2aMessages = internalMessagesToA2A(history, this.session.id, this.session.id);

        // Derive task state from session
        const state = deriveTaskState(history);

        // Create TaskStatus object per A2A spec
        const status: TaskStatus = {
            state,
            timestamp: new Date().toISOString(),
        };

        // Construct A2A task
        const task: Task = {
            id: this.session.id, // taskId === sessionId
            contextId: this.session.id, // For now, contextId === taskId (could be enhanced for multi-task contexts)
            status,
            history: a2aMessages,
            kind: 'task',
            metadata: {
                dexto: {
                    sessionId: this.session.id,
                },
            },
        };

        return task;
    }

    /**
     * Get the underlying session ID.
     * Since taskId === sessionId, this is the same as the task ID.
     */
    get sessionId(): string {
        return this.session.id;
    }

    /**
     * Get the underlying session (for advanced use).
     */
    get session_(): ChatSession {
        return this.session;
    }
}

/**
 * Create a TaskView from a session ID and agent.
 *
 * Convenience factory function.
 *
 * @param sessionId Session/Task ID
 * @param agent DextoAgent instance
 * @returns TaskView wrapper
 */
export async function createTaskView(
    sessionId: string,
    agent: { createSession(id: string): Promise<ChatSession> }
): Promise<TaskView> {
    const session = await agent.createSession(sessionId);
    return new TaskView(session);
}
