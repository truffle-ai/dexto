/**
 * delegate_task Tool
 *
 * Delegates a task to an existing (persistent) sub-agent.
 */

import type { InternalTool } from '@dexto/core';
import { DelegateTaskInputSchema, type DelegateTaskInput } from './schemas.js';
import type { RuntimeService } from './runtime-service.js';

export function createDelegateTaskTool(service: RuntimeService): InternalTool {
    return {
        id: 'delegate_task',
        description: `Delegate a task to an existing persistent sub-agent.

Use this tool when you have previously spawned a persistent agent (ephemeral=false) and want to send it another task.

The sub-agent will execute the task in its existing context, which may include memory of previous tasks.`,

        inputSchema: DelegateTaskInputSchema,

        execute: async (input: unknown) => {
            const validatedInput = input as DelegateTaskInput;

            const result = await service.delegateTask(
                validatedInput.agentId,
                validatedInput.task,
                validatedInput.timeout
            );

            return result;
        },
    };
}
