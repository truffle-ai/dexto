import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../index.js';
import { ScheduleSchema } from '../schemas/responses.js';
import {
    getSchedulerManager,
    ensureSchedulerManagerForAgent,
    SchedulerErrorCode,
} from '@dexto/tools-scheduler';
import { DextoRuntimeError, ErrorType } from '@dexto/core';

const ErrorSchema = z
    .object({
        error: z.string().describe('Error message'),
    })
    .strict()
    .describe('Error response');

const CreateScheduleSchema = z
    .object({
        name: z.string().min(1).describe('Schedule name'),
        instruction: z.string().min(1).describe('Instruction to run on schedule'),
        cronExpression: z.string().min(1).describe('Cron expression'),
        timezone: z.string().optional().describe('Timezone for schedule'),
        enabled: z.boolean().optional().describe('Whether the schedule is enabled'),
        workspacePath: z
            .string()
            .optional()
            .nullable()
            .describe('Optional workspace path for scheduled runs'),
    })
    .strict()
    .describe('Request body for creating a schedule');

const UpdateScheduleSchema = CreateScheduleSchema.partial()
    .extend({ enabled: z.boolean().optional() })
    .strict()
    .describe('Request body for updating a schedule');

const isScheduleNotFoundError = (error: unknown): boolean =>
    error instanceof DextoRuntimeError &&
    error.type === ErrorType.NOT_FOUND &&
    error.code === SchedulerErrorCode.SCHEDULE_NOT_FOUND;

export function createSchedulesRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();
    const resolveScheduler = async (ctx: Parameters<GetAgentFn>[0]) => {
        const agent = await getAgent(ctx);
        const agentId = agent.config?.agentId ?? 'default';
        let scheduler: ReturnType<typeof getSchedulerManager> | null =
            getSchedulerManager(agentId) ?? null;
        if (!scheduler) {
            scheduler = await ensureSchedulerManagerForAgent(agent);
        }
        return { scheduler, agent };
    };

    const listRoute = createRoute({
        method: 'get',
        path: '/schedules',
        summary: 'List Schedules',
        description: 'Retrieves all automation schedules',
        tags: ['schedules'],
        responses: {
            200: {
                description: 'List of schedules',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                schedules: z.array(ScheduleSchema).describe('Schedule list'),
                            })
                            .strict(),
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
        },
    });

    const createRouteDef = createRoute({
        method: 'post',
        path: '/schedules',
        summary: 'Create Schedule',
        description: 'Creates a new automation schedule',
        tags: ['schedules'],
        request: { body: { content: { 'application/json': { schema: CreateScheduleSchema } } } },
        responses: {
            201: {
                description: 'Created schedule',
                content: {
                    'application/json': {
                        schema: z.object({ schedule: ScheduleSchema }).strict(),
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
        },
    });

    const updateRoute = createRoute({
        method: 'patch',
        path: '/schedules/{scheduleId}',
        summary: 'Update Schedule',
        description: 'Updates an existing schedule',
        tags: ['schedules'],
        request: {
            params: z
                .object({
                    scheduleId: z.string().min(1).describe('Schedule ID'),
                })
                .strict()
                .describe('Schedule identifier params'),
            body: { content: { 'application/json': { schema: UpdateScheduleSchema } } },
        },
        responses: {
            200: {
                description: 'Updated schedule',
                content: {
                    'application/json': {
                        schema: z.object({ schedule: ScheduleSchema }).strict(),
                    },
                },
            },
            404: {
                description: 'Schedule not found',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
        },
    });

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/schedules/{scheduleId}',
        summary: 'Delete Schedule',
        description: 'Deletes an automation schedule',
        tags: ['schedules'],
        request: {
            params: z
                .object({
                    scheduleId: z.string().min(1).describe('Schedule ID'),
                })
                .strict()
                .describe('Schedule identifier params'),
        },
        responses: {
            200: {
                description: 'Schedule deleted',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                deleted: z.boolean().describe('Whether the schedule was deleted'),
                            })
                            .strict()
                            .describe('Delete schedule response'),
                    },
                },
            },
            404: {
                description: 'Schedule not found',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
        },
    });

    const triggerRoute = createRoute({
        method: 'post',
        path: '/schedules/{scheduleId}/trigger',
        summary: 'Trigger Schedule',
        description: 'Runs a schedule immediately',
        tags: ['schedules'],
        request: {
            params: z
                .object({
                    scheduleId: z.string().min(1).describe('Schedule ID'),
                })
                .strict()
                .describe('Schedule identifier params'),
        },
        responses: {
            200: {
                description: 'Schedule triggered',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                scheduled: z.boolean().describe('Whether the schedule was queued'),
                            })
                            .strict()
                            .describe('Trigger schedule response'),
                    },
                },
            },
            404: {
                description: 'Schedule not found',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorSchema,
                    },
                },
            },
        },
    });

    return app
        .openapi(listRoute, async (ctx) => {
            const { scheduler } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json({ error: 'Scheduler tools are not enabled for this agent.' }, 503);
            }
            const schedules = await scheduler.listSchedules();
            return ctx.json({ schedules }, 200);
        })
        .openapi(createRouteDef, async (ctx) => {
            const { scheduler } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json({ error: 'Scheduler tools are not enabled for this agent.' }, 503);
            }
            const input = ctx.req.valid('json');
            const createPayload = {
                name: input.name,
                instruction: input.instruction,
                cronExpression: input.cronExpression,
                ...(input.timezone ? { timezone: input.timezone } : {}),
                enabled: input.enabled ?? true,
                ...(input.workspacePath !== undefined
                    ? { workspacePath: input.workspacePath }
                    : {}),
                sessionMode: 'dedicated' as const,
            };
            const schedule = await scheduler.createSchedule(createPayload);
            return ctx.json({ schedule }, 201);
        })
        .openapi(updateRoute, async (ctx) => {
            const { scheduler } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json({ error: 'Scheduler tools are not enabled for this agent.' }, 503);
            }
            const { scheduleId } = ctx.req.valid('param');
            const input = ctx.req.valid('json');
            const updatePayload = {
                ...(input.name ? { name: input.name } : {}),
                ...(input.instruction ? { instruction: input.instruction } : {}),
                ...(input.cronExpression ? { cronExpression: input.cronExpression } : {}),
                ...(input.timezone ? { timezone: input.timezone } : {}),
                ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
                ...(input.workspacePath !== undefined
                    ? { workspacePath: input.workspacePath }
                    : {}),
            };
            try {
                const schedule = await scheduler.updateSchedule(scheduleId, updatePayload);
                return ctx.json({ schedule }, 200);
            } catch (error) {
                if (isScheduleNotFoundError(error)) {
                    return ctx.json({ error: 'Schedule not found' }, 404);
                }
                throw error;
            }
        })
        .openapi(deleteRoute, async (ctx) => {
            const { scheduler } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json({ error: 'Scheduler tools are not enabled for this agent.' }, 503);
            }
            const { scheduleId } = ctx.req.valid('param');
            try {
                await scheduler.deleteSchedule(scheduleId);
                return ctx.json({ deleted: true }, 200);
            } catch (error) {
                if (isScheduleNotFoundError(error)) {
                    return ctx.json({ error: 'Schedule not found' }, 404);
                }
                throw error;
            }
        })
        .openapi(triggerRoute, async (ctx) => {
            const { scheduler } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json({ error: 'Scheduler tools are not enabled for this agent.' }, 503);
            }
            const { scheduleId } = ctx.req.valid('param');
            try {
                await scheduler.triggerScheduleNow(scheduleId);
                return ctx.json({ scheduled: true }, 200);
            } catch (error) {
                if (isScheduleNotFoundError(error)) {
                    return ctx.json({ error: 'Schedule not found' }, 404);
                }
                throw error;
            }
        });
}
