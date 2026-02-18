/**
 * Tool for creating schedules
 */

import type { Tool, ToolExecutionContext } from '@dexto/core';
import { CreateScheduleInputSchema, type CreateScheduleInput } from '../schemas.js';
import type { SchedulerManagerGetter } from '../tool-types.js';

export function createCreateScheduleTool(getManager: SchedulerManagerGetter): Tool {
    return {
        id: 'create_schedule',
        description: `Create a scheduled task that executes automatically at specified times.

Session Modes (sessionMode parameter):
• "ephemeral" (default) - Fresh isolated session each run. Use for: daily reports, monitoring, standalone tasks
• "dedicated" - Persistent session for this schedule. Use for: tracking progress over time, building context across runs
• "inherit" - Continue in THIS conversation. Use for: "remind me in 1 hour", "check back on this later"
• "fixed" - Use specific sessionId. Use for: posting to a known thread, cross-session orchestration

Agent Targeting (targetAgentId parameter):
• Specifies which agent should execute the scheduled task
• Examples: "notes" for notes agent, "filesystem" for file operations, "coding" for code tasks
• If not specified, executes in the orchestrator's context
• Use this to delegate specialized tasks to the appropriate app agent

Examples:
- Daily standup reminder: sessionMode="ephemeral", cronExpression="0 9 * * 1-5"
- Track project daily: sessionMode="dedicated", cronExpression="0 18 * * *"
- Remind me in 2 hours: sessionMode="inherit", cronExpression="0 14 * * *" (one-time)
- Notes backup at midnight: targetAgentId="notes", cronExpression="0 0 * * *"
- Daily code review: targetAgentId="coding", cronExpression="0 17 * * 1-5"`,
        inputSchema: CreateScheduleInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const typedInput = input as CreateScheduleInput;

            // Pass current sessionId for 'inherit' mode
            const manager = await getManager(context);
            const schedule = await manager.createSchedule(typedInput, context.sessionId);

            const sessionInfo =
                schedule.sessionMode === 'inherit'
                    ? `Session: Inheriting current conversation (${schedule.sessionId})`
                    : schedule.sessionMode === 'fixed'
                      ? `Session: Fixed to ${schedule.sessionId}`
                      : schedule.sessionMode === 'dedicated'
                        ? `Session: Dedicated thread for this schedule`
                        : `Session: New isolated session each run`;

            const targetAgent = schedule.task.metadata?.__os_targetAgentId as string | undefined;
            const targetInfo = targetAgent
                ? `Target Agent: ${targetAgent}`
                : `Target Agent: orchestrator (default)`;

            const message = `Schedule created successfully

ID: ${schedule.id}
Name: ${schedule.name}
Cron: ${schedule.cronExpression}
Timezone: ${schedule.timezone}
Mode: ${schedule.sessionMode}
${sessionInfo}
${targetInfo}
Next run: ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : 'calculating...'}

The schedule is now active and will execute automatically.`;

            return { message, schedule };
        },
    };
}
