/**
 * start_task Tool
 *
 * Starts a background task without blocking.
 * This is a higher-level tool that delegates to task-specific providers.
 */

import { z } from 'zod';
import type { OrchestrationTool, OrchestrationToolContext } from './types.js';

/**
 * Input schema for start_task tool
 */
export const StartTaskInputSchema = z
    .object({
        /** Task type to start */
        type: z.enum(['agent', 'process', 'generic']).describe('Type of task to start'),

        // Agent task options
        /** Task description for agent (required for type='agent') */
        task: z.string().optional().describe('Task description for agent execution'),

        /** Custom system prompt for agent */
        systemPrompt: z.string().optional().describe('Custom system prompt for the agent'),

        // Process task options
        /** Command to run (required for type='process') */
        command: z.string().optional().describe('Shell command to execute'),

        // Generic task options
        /** Description for generic task */
        description: z.string().optional().describe('Description of the task'),

        // Common options
        /** Timeout in milliseconds */
        timeout: z.number().positive().optional().describe('Task timeout in milliseconds'),

        /** Auto-notify when complete (triggers agent turn) */
        notify: z.boolean().default(false).describe('Auto-notify when task completes'),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.type === 'agent' && !data.task) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'task is required when type is "agent"',
                path: ['task'],
            });
        }
        if (data.type === 'process' && !data.command) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'command is required when type is "process"',
                path: ['command'],
            });
        }
    });

export type StartTaskInput = z.infer<typeof StartTaskInputSchema>;

/**
 * Output from start_task tool
 */
export interface StartTaskOutput {
    /** Whether task was started successfully */
    success: boolean;
    /** Task ID for tracking */
    taskId?: string;
    /** Error message if failed to start */
    error?: string;
    /** Status */
    status?: 'running';
}

/**
 * Task starter interface - implemented by agent-spawner, process-tools, etc.
 */
export interface TaskStarter {
    /** Start a task and return the promise */
    start(input: StartTaskInput): Promise<{ taskId: string; promise: Promise<unknown> }>;
}

/**
 * Create the start_task tool
 *
 * Note: This tool requires task starters to be registered for each task type.
 * Use `registerTaskStarter` to add support for agent/process/generic tasks.
 */
export function createStartTaskTool(starters: Map<string, TaskStarter>): OrchestrationTool {
    return {
        id: 'start_task',
        description:
            'Start a background task without waiting for completion. ' +
            'Returns immediately with a task ID. ' +
            'Use wait_for or check_task to monitor progress.',
        inputSchema: StartTaskInputSchema,
        execute: async (
            rawInput: unknown,
            context: OrchestrationToolContext
        ): Promise<StartTaskOutput> => {
            const input = StartTaskInputSchema.parse(rawInput);

            // Get the starter for this task type
            const starter = starters.get(input.type);
            if (!starter) {
                return {
                    success: false,
                    error:
                        `No task starter registered for type '${input.type}'. ` +
                        `Available types: ${Array.from(starters.keys()).join(', ') || 'none'}`,
                };
            }

            try {
                // Start the task
                const { taskId, promise } = await starter.start(input);

                // Build options, only including defined values
                const registerOptions = {
                    notify: input.notify,
                    ...(input.timeout !== undefined && { timeout: input.timeout }),
                };

                // Register with task registry based on type
                if (input.type === 'agent') {
                    context.taskRegistry.register(
                        {
                            type: 'agent',
                            taskId,
                            agentId: taskId, // Using taskId as agentId for now
                            taskDescription: input.task ?? '',
                            promise: promise as Promise<import('../types.js').TaskResult>,
                        },
                        registerOptions
                    );
                } else if (input.type === 'process') {
                    context.taskRegistry.register(
                        {
                            type: 'process',
                            taskId,
                            processId: taskId,
                            command: input.command ?? '',
                            promise: promise as Promise<import('../types.js').ProcessResult>,
                        },
                        registerOptions
                    );
                } else {
                    context.taskRegistry.register(
                        {
                            type: 'generic',
                            taskId,
                            description: input.description ?? 'Generic task',
                            promise,
                        },
                        registerOptions
                    );
                }

                return {
                    success: true,
                    taskId,
                    status: 'running',
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}

/**
 * Create a simple generic task starter for testing
 */
export function createGenericTaskStarter(): TaskStarter {
    let taskCounter = 0;

    return {
        async start(input: StartTaskInput) {
            const taskId = `generic-${++taskCounter}`;

            // Create a simple promise that resolves after a delay
            const promise = new Promise((resolve) => {
                setTimeout(() => {
                    resolve({ completed: true, description: input.description });
                }, 1000);
            });

            return { taskId, promise };
        },
    };
}
