/**
 * Tool for updating schedules
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { UpdateScheduleInputSchema, type UpdateScheduleInput } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createUpdateScheduleTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'update_schedule',
        description: `Update an existing scheduled task. Can modify timing, instruction, or session mode.

When changing sessionMode to "inherit", the current conversation will be captured as the target session.`,
        inputSchema: UpdateScheduleInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { scheduleId, ...updates } = input as UpdateScheduleInput;

            // Pass current sessionId for 'inherit' mode
            const manager = await getManager(context);
            const schedule = await manager.updateSchedule(scheduleId, updates, context.sessionId);

            const sessionInfo =
                schedule.sessionMode === 'inherit'
                    ? `Session: Inheriting conversation (${schedule.sessionId})`
                    : schedule.sessionMode === 'fixed'
                      ? `Session: Fixed to ${schedule.sessionId}`
                      : schedule.sessionMode === 'dedicated'
                        ? `Session: Dedicated thread`
                        : `Session: Ephemeral (new each run)`;

            const message = `Schedule updated successfully

ID: ${schedule.id}
Name: ${schedule.name}
Cron: ${schedule.cronExpression}
Mode: ${schedule.sessionMode}
${sessionInfo}
Status: ${schedule.enabled ? 'Enabled' : 'Disabled'}
Next run: ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'N/A'}`;

            return { message, schedule };
        },
    };
}
