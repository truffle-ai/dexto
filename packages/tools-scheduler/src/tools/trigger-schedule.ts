/**
 * Tool for manually triggering schedules
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { TriggerScheduleInputSchema } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createTriggerScheduleTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'trigger_schedule_now',
        description:
            'Manually trigger a schedule to execute immediately, outside of its normal schedule.',
        inputSchema: TriggerScheduleInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { scheduleId } = input as { scheduleId: string };
            const manager = await getManager(context);
            const log = await manager.triggerScheduleNow(scheduleId);

            const durationLine =
                log.duration != null ? `Duration: ${log.duration}ms` : 'Duration: (unknown)';
            const errorLine = log.error ?? 'Unknown error';

            const message =
                log.status === 'success'
                    ? `Schedule executed successfully

Execution ID: ${log.id}
Status: ${log.status}
${durationLine}

Result:
${log.result || '(no result)'}`
                    : `Schedule execution failed

Execution ID: ${log.id}
Status: ${log.status}
${durationLine}
Error: ${errorLine}`;

            return { message, execution: log };
        },
    };
}
