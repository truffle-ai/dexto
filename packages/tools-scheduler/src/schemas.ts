/**
 * Zod schemas for scheduler configuration and validation
 */

import { z } from 'zod';

/**
 * Session mode schema - determines how conversation context is managed
 */
export const ScheduleSessionModeSchema = z
    .enum(['ephemeral', 'dedicated', 'inherit', 'fixed'])
    .describe(
        `How to manage conversation context for scheduled executions:
• ephemeral - New isolated session each time (default). Use for standalone tasks like reports.
• dedicated - Persistent session for this schedule. Builds context over multiple runs.
• inherit - Continue in the current conversation. Use for "remind me later" scenarios.
• fixed - Use a specific sessionId. Advanced: for cross-session orchestration.`
    );

export type ScheduleSessionMode = z.infer<typeof ScheduleSessionModeSchema>;

/**
 * Scheduler tool provider configuration schema
 */
export const SchedulerToolsConfigSchema = z
    .object({
        type: z.literal('scheduler-tools'),
        timezone: z.string().default('UTC').describe('Default timezone for schedules'),
        maxSchedules: z.number().default(100).describe('Maximum number of schedules'),
        executionTimeout: z
            .number()
            .default(300000)
            .describe('Maximum execution time in milliseconds (default 5 minutes)'),
        maxExecutionHistory: z
            .number()
            .default(100)
            .describe('Maximum execution history entries to keep'),
    })
    .strict();

export type SchedulerToolsConfig = z.output<typeof SchedulerToolsConfigSchema>;

/**
 * Input schema for creating schedules via tools
 *
 * Session Mode Examples:
 * - Standalone report: sessionMode='ephemeral' (fresh context each time)
 * - Ongoing project check: sessionMode='dedicated' (builds history)
 * - "Remind me in 1 hour": sessionMode='inherit' (continues this conversation)
 * - Cross-thread task: sessionMode='fixed', sessionId='target-session-id'
 */
export const CreateScheduleInputSchema = z
    .object({
        name: z
            .string()
            .min(1)
            .max(100)
            .describe(
                'Human-readable name for the schedule (e.g., "Coffee Reminder", "Daily Standup")'
            ),
        cronExpression: z
            .string()
            .describe('Cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am)'),
        instruction: z
            .string()
            .min(1)
            .describe(
                'What should happen when this schedule triggers. Be natural and clear about the intent.'
            ),
        timezone: z.string().optional().describe('Optional timezone (defaults to config timezone)'),
        enabled: z.boolean().default(true).describe('Whether schedule is enabled'),
        metadata: z.record(z.unknown()).optional().describe('Optional metadata for the task'),
        workspacePath: z
            .string()
            .optional()
            .nullable()
            .describe('Optional workspace path for scheduled runs'),
        sessionMode: ScheduleSessionModeSchema.default('ephemeral').describe(
            `Session context mode:
• ephemeral (default) - Fresh session each run. Example: "Send daily report"
• dedicated - Same session across runs. Example: "Track project progress daily"
• inherit - Continue current conversation. Example: "Remind me about this in 2 hours"
• fixed - Specific session. Example: "Post update to session abc-123"`
        ),
        sessionId: z
            .string()
            .optional()
            .describe(
                'Target session ID. Required for "fixed" mode. For "inherit", this is auto-captured.'
            ),
        targetAgentId: z
            .string()
            .optional()
            .describe(
                'Target agent ID to execute this schedule (e.g., "notes", "filesystem", "coding"). If not specified, executes in the creator agent context. Use this to delegate scheduled tasks to specialized agents.'
            ),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.sessionMode === 'fixed' && !data.sessionId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'sessionId is required when sessionMode is "fixed"',
                path: ['sessionId'],
            });
        }
    });

export type CreateScheduleInput = z.output<typeof CreateScheduleInputSchema>;

/**
 * Base schema for update schedule fields (without scheduleId)
 */
const UpdateScheduleFieldsSchema = z
    .object({
        name: z.string().min(1).max(100).optional().describe('Updated name'),
        cronExpression: z.string().optional().describe('Updated cron expression'),
        instruction: z
            .string()
            .min(1)
            .optional()
            .describe('Updated instruction - what should happen when this schedule triggers'),
        timezone: z.string().optional().describe('Updated timezone'),
        enabled: z.boolean().optional().describe('Updated enabled state'),
        metadata: z.record(z.unknown()).optional().describe('Updated metadata'),
        workspacePath: z
            .string()
            .optional()
            .nullable()
            .describe('Updated workspace path for scheduled runs'),
        sessionMode: ScheduleSessionModeSchema.optional().describe(
            'Updated session mode (ephemeral, dedicated, inherit, fixed)'
        ),
        sessionId: z
            .string()
            .optional()
            .describe('Updated session ID (required if changing to "fixed" mode)'),
        targetAgentId: z
            .string()
            .optional()
            .describe(
                'Updated target agent ID. Set to reassign schedule execution to a different agent.'
            ),
    })
    .strict();

/**
 * Input schema for updating schedules
 */
export const UpdateScheduleInputSchema = UpdateScheduleFieldsSchema.extend({
    scheduleId: z.string().describe('The schedule ID to update'),
}).superRefine((data, ctx) => {
    if (data.sessionMode === 'fixed' && !data.sessionId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'sessionId is required when sessionMode is "fixed"',
            path: ['sessionId'],
        });
    }
});

export type UpdateScheduleInput = z.output<typeof UpdateScheduleInputSchema>;

/**
 * Schema for update fields only (used by manager)
 */
export const UpdateScheduleFieldsOnlySchema = UpdateScheduleFieldsSchema;

/**
 * Input schema for getting a schedule
 */
export const GetScheduleInputSchema = z
    .object({
        scheduleId: z.string().describe('The schedule ID'),
    })
    .strict();

export type GetScheduleInput = z.output<typeof GetScheduleInputSchema>;

/**
 * Input schema for deleting a schedule
 */
export const DeleteScheduleInputSchema = z
    .object({
        scheduleId: z.string().describe('The schedule ID to delete'),
    })
    .strict();

export type DeleteScheduleInput = z.output<typeof DeleteScheduleInputSchema>;

/**
 * Input schema for triggering a schedule
 */
export const TriggerScheduleInputSchema = z
    .object({
        scheduleId: z.string().describe('The schedule ID to trigger'),
    })
    .strict();

export type TriggerScheduleInput = z.output<typeof TriggerScheduleInputSchema>;

/**
 * Input schema for getting schedule history
 */
export const GetScheduleHistoryInputSchema = z
    .object({
        scheduleId: z.string().describe('The schedule ID'),
        limit: z
            .number()
            .optional()
            .describe('Maximum number of history entries to return (default: 10)'),
    })
    .strict();

export type GetScheduleHistoryInput = z.output<typeof GetScheduleHistoryInputSchema>;

/**
 * Input schema for listing schedules
 */
export const ListSchedulesInputSchema = z
    .object({
        enabled: z.boolean().optional().describe('Filter by enabled status (true/false)'),
    })
    .strict();

export type ListSchedulesInput = z.output<typeof ListSchedulesInputSchema>;
