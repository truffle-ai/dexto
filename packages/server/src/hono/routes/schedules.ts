import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../index.js';
import {
    ErrorResponseSchema,
    ExecutionLogSchema,
    ScheduleSchema,
    type ErrorResponse,
} from '../schemas/responses.js';
import {
    getSchedulerManager,
    ensureSchedulerManagerForAgent,
    SchedulerErrorCode,
} from '@dexto/tools-scheduler';
import { DextoRuntimeError, ErrorType } from '@dexto/core';

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
    .strict()
    .describe('Request body for updating a schedule');

const isScheduleNotFoundError = (error: unknown): boolean =>
    error instanceof DextoRuntimeError &&
    error.type === ErrorType.NOT_FOUND &&
    error.code === SchedulerErrorCode.SCHEDULE_NOT_FOUND;

const logSchedulerError = (
    agent:
        | { logger?: { error: (message: string, context?: Record<string, unknown>) => void } }
        | undefined,
    message: string,
    error: unknown
) => {
    if (!agent?.logger) {
        return;
    }
    agent.logger.error(message, {
        error: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
        stack: error instanceof Error ? error.stack : undefined,
        code: error instanceof DextoRuntimeError ? error.code : undefined,
    });
};

const toErrorResponse = (message: string, code?: string): ErrorResponse => ({
    ok: false,
    error: {
        message,
        ...(code ? { code } : {}),
    },
});

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
            500: {
                description: 'Failed to list schedules',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
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
            400: {
                description: 'Validation error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            429: {
                description: 'Schedule limit reached',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Failed to create schedule',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
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
            400: {
                description: 'Validation error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            404: {
                description: 'Schedule not found',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Failed to update schedule',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
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
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Failed to delete schedule',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });

    const triggerRoute = createRoute({
        method: 'post',
        path: '/schedules/{scheduleId}/trigger',
        summary: 'Trigger Schedule',
        description:
            'Runs a schedule immediately and waits for execution to complete (bounded by executionTimeout, default 5 minutes). Clients should set timeouts accordingly.',
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
                                scheduled: z
                                    .boolean()
                                    .describe(
                                        'Whether the schedule was queued. Execution is omitted when false.'
                                    ),
                                execution: ExecutionLogSchema.optional().describe(
                                    'Execution log (present when scheduled is true)'
                                ),
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
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Failed to trigger schedule',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            503: {
                description: 'Scheduler tools are not enabled',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });

    return app
        .openapi(listRoute, async (ctx) => {
            const { scheduler, agent } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json(
                    toErrorResponse('Scheduler tools are not enabled for this agent.'),
                    503
                );
            }
            try {
                const schedules = await scheduler.listSchedules();
                return ctx.json({ schedules }, 200);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error ?? 'Unknown error');
                logSchedulerError(agent, 'Failed to list schedules', error);

                if (error instanceof DextoRuntimeError) {
                    return ctx.json(toErrorResponse(message, String(error.code)), 500);
                }

                return ctx.json(toErrorResponse('Failed to list schedules'), 500);
            }
        })
        .openapi(createRouteDef, async (ctx) => {
            const { scheduler, agent } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json(
                    toErrorResponse('Scheduler tools are not enabled for this agent.'),
                    503
                );
            }
            const input = ctx.req.valid('json');
            const createPayload = {
                name: input.name,
                instruction: input.instruction,
                cronExpression: input.cronExpression,
                ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
                enabled: input.enabled ?? true,
                ...(input.workspacePath !== undefined
                    ? { workspacePath: input.workspacePath }
                    : {}),
                sessionMode: 'dedicated' as const,
            };
            try {
                const schedule = await scheduler.createSchedule(createPayload);
                return ctx.json({ schedule }, 201);
            } catch (error) {
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === SchedulerErrorCode.SCHEDULE_INVALID_CRON
                ) {
                    return ctx.json(toErrorResponse(error.message, String(error.code)), 400);
                }
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === SchedulerErrorCode.SCHEDULE_INVALID_INPUT
                ) {
                    return ctx.json(toErrorResponse(error.message, String(error.code)), 400);
                }
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === SchedulerErrorCode.SCHEDULE_LIMIT_REACHED
                ) {
                    return ctx.json(toErrorResponse(error.message, String(error.code)), 429);
                }

                logSchedulerError(agent, 'Failed to create schedule', error);

                return ctx.json(toErrorResponse('Failed to create schedule'), 500);
            }
        })
        .openapi(updateRoute, async (ctx) => {
            const { scheduler, agent } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json(
                    toErrorResponse('Scheduler tools are not enabled for this agent.'),
                    503
                );
            }
            const { scheduleId } = ctx.req.valid('param');
            const input = ctx.req.valid('json');
            const updatePayload = {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
                ...(input.cronExpression !== undefined
                    ? { cronExpression: input.cronExpression }
                    : {}),
                ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
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
                    return ctx.json(
                        toErrorResponse(
                            'Schedule not found',
                            SchedulerErrorCode.SCHEDULE_NOT_FOUND
                        ),
                        404
                    );
                }
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === SchedulerErrorCode.SCHEDULE_INVALID_CRON
                ) {
                    return ctx.json(toErrorResponse(error.message, String(error.code)), 400);
                }
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === SchedulerErrorCode.SCHEDULE_INVALID_INPUT
                ) {
                    return ctx.json(toErrorResponse(error.message, String(error.code)), 400);
                }

                logSchedulerError(agent, 'Failed to update schedule', error);

                return ctx.json(toErrorResponse('Failed to update schedule'), 500);
            }
        })
        .openapi(deleteRoute, async (ctx) => {
            const { scheduler, agent } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json(
                    toErrorResponse('Scheduler tools are not enabled for this agent.'),
                    503
                );
            }
            const { scheduleId } = ctx.req.valid('param');
            try {
                await scheduler.deleteSchedule(scheduleId);
                return ctx.json({ deleted: true }, 200);
            } catch (error) {
                if (isScheduleNotFoundError(error)) {
                    return ctx.json(
                        toErrorResponse(
                            'Schedule not found',
                            SchedulerErrorCode.SCHEDULE_NOT_FOUND
                        ),
                        404
                    );
                }
                logSchedulerError(agent, 'Failed to delete schedule', error);

                return ctx.json(toErrorResponse('Failed to delete schedule'), 500);
            }
        })
        .openapi(triggerRoute, async (ctx) => {
            const { scheduler, agent } = await resolveScheduler(ctx);
            if (!scheduler) {
                return ctx.json(
                    toErrorResponse('Scheduler tools are not enabled for this agent.'),
                    503
                );
            }
            const { scheduleId } = ctx.req.valid('param');
            try {
                const execution = await scheduler.triggerScheduleNow(scheduleId);
                return ctx.json({ scheduled: true, execution }, 200);
            } catch (error) {
                if (isScheduleNotFoundError(error)) {
                    return ctx.json(
                        toErrorResponse(
                            'Schedule not found',
                            SchedulerErrorCode.SCHEDULE_NOT_FOUND
                        ),
                        404
                    );
                }
                logSchedulerError(agent, 'Failed to trigger schedule', error);

                return ctx.json(toErrorResponse('Failed to trigger schedule'), 500);
            }
        });
}
