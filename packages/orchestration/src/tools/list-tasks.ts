/**
 * list_tasks Tool
 *
 * List all tracked background tasks with optional filtering.
 */

import { z } from 'zod';
import type { TaskStatus } from '../types.js';
import type { OrchestrationTool, OrchestrationToolContext } from './types.js';

/**
 * Input schema for list_tasks tool
 */
export const ListTasksInputSchema = z
    .object({
        /** Filter by status */
        status: z
            .enum(['running', 'completed', 'failed', 'cancelled', 'all'])
            .optional()
            .default('all')
            .describe('Filter tasks by status'),

        /** Filter by type */
        type: z.enum(['agent', 'process', 'generic']).optional().describe('Filter tasks by type'),
    })
    .strict();

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

/**
 * Task info in list output
 */
export interface TaskListItem {
    taskId: string;
    type: 'agent' | 'process' | 'generic';
    status: TaskStatus;
    description?: string;
    startedAt: string;
    completedAt?: string;
    duration?: number;
}

/**
 * Output from list_tasks tool
 */
export interface ListTasksOutput {
    /** List of tasks matching filter */
    tasks: TaskListItem[];
    /** Total count */
    count: number;
    /** Counts by status */
    counts: {
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        pending: number;
    };
}

/**
 * Create the list_tasks tool
 */
export function createListTasksTool(): OrchestrationTool {
    return {
        id: 'list_tasks',
        description:
            'List all background tasks with optional filtering by status or type. ' +
            'Returns task information and counts.',
        inputSchema: ListTasksInputSchema,
        execute: async (
            rawInput: unknown,
            context: OrchestrationToolContext
        ): Promise<ListTasksOutput> => {
            const input = ListTasksInputSchema.parse(rawInput);

            // Build filter
            const filter: {
                status?: TaskStatus | TaskStatus[];
                type?: 'agent' | 'process' | 'generic';
            } = {};

            if (input.status && input.status !== 'all') {
                filter.status = input.status as TaskStatus;
            }

            if (input.type) {
                filter.type = input.type;
            }

            // Get filtered list
            const tasks = context.taskRegistry.list(filter);

            // Get all tasks for counts
            const allTasks = context.taskRegistry.list();

            // Calculate counts
            const counts = {
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
                pending: 0,
            };

            for (const task of allTasks) {
                counts[task.status]++;
            }

            return {
                tasks: tasks.map((t) => ({
                    taskId: t.taskId,
                    type: t.type,
                    status: t.status,
                    startedAt: t.startedAt.toISOString(),
                    ...(t.description !== undefined && { description: t.description }),
                    ...(t.completedAt !== undefined && {
                        completedAt: t.completedAt.toISOString(),
                    }),
                    ...(t.duration !== undefined && { duration: t.duration }),
                })),
                count: tasks.length,
                counts,
            };
        },
    };
}
