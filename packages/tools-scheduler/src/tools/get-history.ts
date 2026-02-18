/**
 * Tool for getting schedule execution history
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { GetScheduleHistoryInputSchema } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createGetScheduleHistoryTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'get_schedule_history',
        description:
            'Get the execution history for a schedule, showing past runs and their results.',
        inputSchema: GetScheduleHistoryInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { scheduleId, limit = 10 } = input as { scheduleId: string; limit?: number };
            const manager = await getManager(context);
            const logs = await manager.getExecutionHistory(scheduleId, limit);

            if (logs.length === 0) {
                return {
                    message: `No execution history found for schedule: ${scheduleId}`,
                    history: [],
                };
            }

            const historyList = logs
                .map((log) => {
                    const statusIcon =
                        log.status === 'success'
                            ? '[SUCCESS]'
                            : log.status === 'failed'
                              ? '[FAILED]'
                              : log.status === 'timeout'
                                ? '[TIMEOUT]'
                                : '[PENDING]';
                    return `
${statusIcon} Execution ID: ${log.id}
  Status: ${log.status}
  Triggered: ${new Date(log.triggeredAt).toISOString()}
  ${log.completedAt ? `Completed: ${new Date(log.completedAt).toISOString()}` : ''}
  ${log.duration ? `Duration: ${log.duration}ms` : ''}
  ${log.error ? `Error: ${log.error}` : ''}
  ${log.result ? `Result: ${log.result.substring(0, 200)}${log.result.length > 200 ? '...' : ''}` : ''}
---`;
                })
                .join('\n');

            return {
                message: `Execution history for schedule ${scheduleId} (showing ${logs.length} most recent):\n${historyList}`,
                history: logs,
            };
        },
    };
}
