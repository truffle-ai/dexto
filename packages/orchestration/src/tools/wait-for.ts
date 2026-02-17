/**
 * wait_for Tool
 *
 * Suspends agent execution until condition is met using a blocking promise.
 * TurnExecutor naturally awaits tool execution, so this works seamlessly.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { ConditionEngine } from '../condition-engine.js';
import type { WaitCondition, Signal } from '../types.js';
import type { Tool } from '@dexto/core';

/**
 * Input schema for wait_for tool
 */
export const WaitForInputSchema = z
    .object({
        /** Wait for a single task */
        taskId: z.string().optional().describe('Task ID to wait for'),

        /** Wait for multiple tasks */
        taskIds: z.array(z.string()).optional().describe('Array of task IDs to wait for'),

        /** Mode for multiple tasks: any = first to complete, all = wait for all */
        mode: z
            .enum(['any', 'all'])
            .optional()
            .default('all')
            .describe('Wait mode: "any" returns when first completes, "all" waits for all'),

        /** Timeout in milliseconds */
        timeout: z.number().positive().optional().describe('Maximum time to wait in milliseconds'),
    })
    .strict()
    .refine(
        (data) =>
            data.taskId !== undefined || (data.taskIds !== undefined && data.taskIds.length > 0),
        { message: 'Either taskId or taskIds must be provided' }
    );

export type WaitForInput = z.output<typeof WaitForInputSchema>;

/**
 * Output from wait_for tool
 */
export interface WaitForOutput {
    /** Task ID that triggered the return (for 'any' mode) */
    taskId: string;
    /** Final status */
    status: 'completed' | 'failed' | 'cancelled' | 'timeout';
    /** Result if completed */
    result?: unknown;
    /** Error if failed */
    error?: string;
    /** All results for 'all' mode */
    allResults?: Array<{
        taskId: string;
        status: 'completed' | 'failed' | 'cancelled';
        result?: unknown;
        error?: string;
    }>;
}

/**
 * Build wait condition from input
 */
function buildCondition(input: WaitForInput): WaitCondition {
    const taskIds = input.taskId ? [input.taskId] : (input.taskIds ?? []);

    if (taskIds.length === 0) {
        throw new Error('At least one taskId is required');
    }

    const firstTaskId = taskIds[0] as string; // Safe after length check
    let baseCondition: WaitCondition;

    if (taskIds.length === 1) {
        baseCondition = { type: 'task', taskId: firstTaskId };
    } else if (input.mode === 'any') {
        baseCondition = ConditionEngine.createAnyTask(taskIds);
    } else {
        baseCondition = ConditionEngine.createAllTasks(taskIds);
    }

    // Add timeout if specified - wrap the actual condition in a race
    if (input.timeout !== undefined) {
        return {
            type: 'race',
            task: baseCondition,
            timeout: {
                type: 'timeout',
                ms: input.timeout,
                conditionId: `timeout-${randomUUID().slice(0, 8)}`,
            },
        };
    }

    return baseCondition;
}

/**
 * Format signal to output
 */
function formatOutput(signal: Signal, allSignals?: Signal[]): WaitForOutput {
    if (signal.type === 'timeout') {
        return {
            taskId: signal.conditionId,
            status: 'timeout',
            error: 'Wait timed out',
        };
    }

    const baseOutput: WaitForOutput = {
        taskId: 'taskId' in signal ? signal.taskId : '',
        status:
            signal.type === 'task:completed'
                ? 'completed'
                : signal.type === 'task:failed'
                  ? 'failed'
                  : 'cancelled',
    };

    if (signal.type === 'task:completed') {
        baseOutput.result = signal.result;
    } else if (signal.type === 'task:failed') {
        baseOutput.error = signal.error;
    }

    // Add all results for 'all' mode
    if (allSignals && allSignals.length > 1) {
        baseOutput.allResults = allSignals.map((s) => {
            if (s.type === 'task:completed') {
                return { taskId: s.taskId, status: 'completed' as const, result: s.result };
            } else if (s.type === 'task:failed') {
                return { taskId: s.taskId, status: 'failed' as const, error: s.error };
            } else if (s.type === 'task:cancelled') {
                return { taskId: s.taskId, status: 'cancelled' as const };
            }
            return { taskId: '', status: 'failed' as const, error: 'Unknown signal type' };
        });
    }

    return baseOutput;
}

/**
 * Create the wait_for tool
 */
export function createWaitForTool(
    conditionEngine: ConditionEngine
): Tool<typeof WaitForInputSchema> {
    return {
        id: 'wait_for',
        displayName: 'Wait',
        description:
            'Wait for background task(s) to complete. ' +
            'Blocks execution until the condition is met. ' +
            'Use taskId for a single task, or taskIds with mode for multiple tasks.',
        inputSchema: WaitForInputSchema,
        execute: async (input, _context): Promise<WaitForOutput> => {
            const condition = buildCondition(input);

            // This blocks until condition is met (the key design!)
            const { signal, allSignals } = await conditionEngine.wait(condition);

            return formatOutput(signal, allSignals);
        },
    };
}
