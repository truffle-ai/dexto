/**
 * Tool for getting schedule details
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { GetScheduleInputSchema } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createGetScheduleTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'get_schedule',
        description: 'Get detailed information about a specific schedule by ID.',
        inputSchema: GetScheduleInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { scheduleId } = input as { scheduleId: string };
            const manager = await getManager(context);
            const schedule = await manager.getSchedule(scheduleId);

            if (!schedule) {
                throw new Error(`Schedule not found: ${scheduleId}`);
            }

            const message = `
Schedule Details:

ID: ${schedule.id}
Name: ${schedule.name}
Status: ${schedule.enabled ? 'Enabled' : 'Disabled'}
Cron Expression: ${schedule.cronExpression}
Timezone: ${schedule.timezone}

Task:
  Instruction: ${schedule.task.instruction}
  Metadata: ${JSON.stringify(schedule.task.metadata || {}, null, 2)}

Statistics:
  Total runs: ${schedule.runCount}
  Successful: ${schedule.successCount}
  Failed: ${schedule.failureCount}
  Last run: ${schedule.lastRunAt ? new Date(schedule.lastRunAt).toISOString() : 'Never'}
  Next run: ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'N/A'}
  ${schedule.lastError ? `Last error: ${schedule.lastError}` : ''}

Created: ${new Date(schedule.createdAt).toISOString()}
Updated: ${new Date(schedule.updatedAt).toISOString()}
`;

            return { message, schedule };
        },
    };
}
