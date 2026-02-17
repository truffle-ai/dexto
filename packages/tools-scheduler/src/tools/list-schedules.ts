/**
 * Tool for listing schedules
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { ListSchedulesInputSchema, type ListSchedulesInput } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createListSchedulesTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'list_schedules',
        description: 'List all scheduled tasks. Optionally filter by enabled status.',
        inputSchema: ListSchedulesInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const manager = await getManager(context);
            const { enabled } = input as ListSchedulesInput;
            const schedules = await manager.listSchedules(enabled !== undefined ? { enabled } : {});

            if (schedules.length === 0) {
                // Return structured data with LLM-friendly message
                return {
                    message: 'No schedules found.',
                    schedules: [],
                };
            }

            const scheduleList = schedules
                .map((s) => {
                    const status = s.enabled ? 'Enabled' : 'Disabled';
                    const nextRun = s.nextRunAt ? new Date(s.nextRunAt).toISOString() : 'N/A';
                    const lastRun = s.lastRunAt ? new Date(s.lastRunAt).toISOString() : 'Never';
                    return `
ID: ${s.id}
Name: ${s.name}
Status: ${status}
Cron: ${s.cronExpression}
Timezone: ${s.timezone}
Runs: ${s.runCount} (${s.successCount} success, ${s.failureCount} failed)
Last run: ${lastRun}
Next run: ${nextRun}
${s.lastError ? `Last error: ${s.lastError}` : ''}
---`;
                })
                .join('\n');

            // Return structured data with both message (for LLM) and schedules (for programmatic access)
            return {
                message: `Found ${schedules.length} schedule(s):\n${scheduleList}`,
                schedules,
            };
        },
    };
}
