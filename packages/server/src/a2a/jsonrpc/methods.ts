/**
 * A2A Protocol JSON-RPC Method Handlers
 *
 * Implements A2A Protocol v0.3.0 RPC methods by calling DextoAgent.
 * These are thin wrappers that translate between A2A protocol and DextoAgent API.
 *
 * Method names per spec:
 * - message/send - Send a message to the agent
 * - message/stream - Send a message with streaming response
 * - tasks/get - Retrieve a specific task
 * - tasks/list - List tasks with optional filtering
 * - tasks/cancel - Cancel an in-progress task
 */

import type { DextoAgent } from '@dexto/core';
import type {
    Task,
    Message,
    MessageSendParams,
    TaskQueryParams,
    ListTasksParams,
    ListTasksResult,
    TaskIdParams,
} from '../types.js';
import { TaskView } from '../adapters/task-view.js';
import { a2aToInternalMessage } from '../adapters/message.js';

/**
 * A2A Method Handlers
 *
 * Implements all A2A Protocol JSON-RPC methods.
 * Each method:
 * 1. Validates params
 * 2. Calls DextoAgent methods
 * 3. Converts response to A2A format using TaskView
 *
 * Usage:
 * ```typescript
 * const handlers = new A2AMethodHandlers(agent);
 * const server = new JsonRpcServer({
 *   methods: handlers.getMethods()
 * });
 * ```
 */
export class A2AMethodHandlers {
    constructor(private agent: DextoAgent) {}

    /**
     * message/send - Send a message to the agent
     *
     * This is the primary method for interacting with an agent.
     * Creates a task if taskId not provided in message, or adds to existing task.
     *
     * @param params Message send parameters
     * @returns Task or Message depending on configuration.blocking
     */
    async messageSend(params: MessageSendParams): Promise<Task | Message> {
        if (!params?.message) {
            throw new Error('message is required');
        }

        const { message } = params;

        // Extract taskId from message (or generate new one)
        const taskId = message.taskId;

        // Create or get session
        const session = await this.agent.createSession(taskId);

        // Convert A2A message to internal format and run
        const { text, image, file } = a2aToInternalMessage(message);
        await this.agent.run(text, image, file, session.id);

        // Return task view
        const taskView = new TaskView(session);
        const task = await taskView.toA2ATask();

        // If blocking=false, return just the message (non-blocking)
        // For now, always return task (blocking behavior)
        // TODO: Implement non-blocking mode that returns Message
        return task;
    }

    /**
     * tasks/get - Retrieve a task by ID
     *
     * @param params Parameters containing task ID
     * @returns Task details
     */
    async tasksGet(params: TaskQueryParams): Promise<Task> {
        if (!params?.id) {
            throw new Error('id is required');
        }

        // Get session by ID (taskId === sessionId)
        const session = await this.agent.createSession(params.id);

        // Convert to task view
        const taskView = new TaskView(session);
        return await taskView.toA2ATask();
    }

    /**
     * tasks/list - List all tasks (optional filters)
     *
     * Note: This is a simple implementation that lists all sessions.
     * For production, filtering by status, pagination, etc. would be added.
     *
     * @param params Optional filter parameters
     * @returns List of tasks with pagination info
     */
    async tasksList(params?: ListTasksParams): Promise<ListTasksResult> {
        // Get all session IDs
        const sessionIds = await this.agent.listSessions();

        // Apply pagination if provided
        const pageSize = Math.min(params?.pageSize ?? 50, 100);
        const offset = 0; // TODO: Implement proper pagination with pageToken

        const paginatedIds = sessionIds.slice(offset, offset + pageSize);

        // Convert each session to task view
        const tasks: Task[] = [];
        for (const sessionId of paginatedIds) {
            const session = await this.agent.createSession(sessionId);
            const taskView = new TaskView(session);
            const task = await taskView.toA2ATask();

            // Filter by status if provided
            if (params?.status && task.status.state !== params.status) {
                continue;
            }

            // Filter by contextId if provided
            if (params?.contextId && task.contextId !== params.contextId) {
                continue;
            }

            tasks.push(task);
        }

        return {
            tasks,
            totalSize: tasks.length,
            pageSize,
            nextPageToken: '', // TODO: Implement pagination tokens
        };
    }

    /**
     * tasks/cancel - Cancel a running task
     *
     * @param params Parameters containing task ID
     * @returns Updated task (in canceled state)
     */
    async tasksCancel(params: TaskIdParams): Promise<Task> {
        if (!params?.id) {
            throw new Error('id is required');
        }

        // Get session and cancel it
        const session = await this.agent.createSession(params.id);
        session.cancel();

        // Return updated task view
        const taskView = new TaskView(session);
        return await taskView.toA2ATask();
    }

    /**
     * message/stream - Send a message with streaming response
     *
     * This is a streaming variant of message/send. Instead of returning a complete Task,
     * it returns a stream of TaskStatusUpdateEvent and TaskArtifactUpdateEvent as the
     * agent processes the message.
     *
     * Note: This method signature is for the handler registry. The actual streaming
     * is handled by the transport layer (JSON-RPC or REST) which will return an SSE stream.
     *
     * @param params Message send parameters (same as message/send)
     * @returns Task ID for streaming (transport layer handles actual SSE stream)
     */
    async messageStream(params: MessageSendParams): Promise<{ taskId: string }> {
        if (!params?.message) {
            throw new Error('message is required');
        }

        const { message } = params;

        // Extract taskId from message (or generate new one)
        const taskId = message.taskId;

        // Create or get session
        const session = await this.agent.createSession(taskId);

        // Return task ID immediately - the transport layer will handle
        // setting up the SSE stream and calling agent.run() with streaming
        return { taskId: session.id };
    }

    /**
     * Get all method handlers as a Record for JsonRpcServer
     *
     * Returns methods with A2A-compliant names (slash notation).
     *
     * @returns Map of method names to handlers
     */
    getMethods(): Record<string, (params: any) => Promise<any>> {
        return {
            'message/send': this.messageSend.bind(this),
            'message/stream': this.messageStream.bind(this),
            'tasks/get': this.tasksGet.bind(this),
            'tasks/list': this.tasksList.bind(this),
            'tasks/cancel': this.tasksCancel.bind(this),
        };
    }
}
