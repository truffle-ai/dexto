/**
 * Tool for deleting schedules
 */

import { TOOL_ACTIVITY, type Tool, type ToolExecutionContext } from '@dexto/core';
import { DeleteScheduleInputSchema } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createDeleteScheduleTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'delete_schedule',
        description:
            'Delete a schedule permanently. This will stop all future executions of the schedule.',
        inputSchema: DeleteScheduleInputSchema,
        presentation: { activity: TOOL_ACTIVITY.deleteSchedule },
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { scheduleId } = input as { scheduleId: string };
            const manager = await getManager(context);
            await manager.deleteSchedule(scheduleId);

            return {
                message: `Schedule deleted successfully: ${scheduleId}`,
                deleted: true,
                scheduleId,
            };
        },
    };
}
