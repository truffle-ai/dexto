/**
 * check_task Tool
 *
 * Non-blocking status check for a background task.
 */

import { z } from 'zod';
import type { Tool } from '@dexto/core';
import type { TaskRegistry } from '../task-registry.js';

/**
 * Input schema for check_task tool
 */
export const CheckTaskInputSchema = z
    .object({
        /** Task ID to check */
        taskId: z.string().describe('Task ID to check status of'),
    })
    .strict();

export type CheckTaskInput = z.output<typeof CheckTaskInputSchema>;

/**
 * Output from check_task tool
 */
export interface CheckTaskOutput {
    /** Task ID */
    taskId: string;
    /** Whether task was found */
    found: boolean;
    /** Task type */
    type?: 'agent' | 'process' | 'generic';
    /** Current status */
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    /** Description of what the task is doing */
    description?: string;
    /** When the task started */
    startedAt?: string;
    /** When the task completed (if done) */
    completedAt?: string;
    /** Duration in milliseconds (if completed) */
    duration?: number;
    /** Result (if completed successfully) */
    result?: unknown;
    /** Error message (if failed) */
    error?: string;
}

/**
 * Create the check_task tool
 */
export function createCheckTaskTool(taskRegistry: TaskRegistry): Tool {
    return {
        id: 'check_task',
        description:
            'Check the status of a background task. ' +
            'Returns immediately without waiting. ' +
            'Use this to poll task status or check if a task is done.',
        inputSchema: CheckTaskInputSchema,
        execute: async (rawInput: unknown): Promise<CheckTaskOutput> => {
            const input = CheckTaskInputSchema.parse(rawInput);
            const info = taskRegistry.getInfo(input.taskId);

            if (!info) {
                return {
                    taskId: input.taskId,
                    found: false,
                };
            }

            return {
                taskId: info.taskId,
                found: true,
                type: info.type,
                status: info.status,
                startedAt: info.startedAt.toISOString(),
                ...(info.description !== undefined && { description: info.description }),
                ...(info.completedAt !== undefined && {
                    completedAt: info.completedAt.toISOString(),
                }),
                ...(info.duration !== undefined && { duration: info.duration }),
                ...(info.result !== undefined && { result: info.result }),
                ...(info.error !== undefined && { error: info.error }),
            };
        },
    };
}
