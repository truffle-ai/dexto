import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
    ApiErrorResponseSchema,
    InternalErrorResponse,
    SkillDocumentSchema,
    SkillSummarySchema,
} from '../schemas/responses.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';

const SkillIdParamSchema = z
    .object({
        id: z.string().min(1, 'Skill id is required').describe('The skill identifier'),
    })
    .describe('Path parameters for skill endpoints');

const ListSkillsResponseSchema = z
    .object({
        skills: z.array(SkillSummarySchema).describe('Array of available skills'),
    })
    .strict()
    .describe('Skills list response');

const GetSkillResponseSchema = z
    .object({
        skill: SkillDocumentSchema.describe('Skill document'),
    })
    .strict()
    .describe('Get skill response');

function serializeSkillSummary(skill: z.input<typeof SkillSummarySchema>) {
    const { id, displayName, description } = skill;
    return SkillSummarySchema.parse({ id, displayName, description });
}

function serializeSkillDocument(skill: z.input<typeof SkillDocumentSchema>) {
    const { id, displayName, description, instructions } = skill;
    return SkillDocumentSchema.parse({ id, displayName, description, instructions });
}

const listRoute = createRoute({
    method: 'get',
    path: '/skills',
    summary: 'List Skills',
    description: 'Retrieves available skills from the active agent skill catalog',
    tags: ['skills'],
    responses: {
        200: {
            description: 'List all skills',
            content: {
                'application/json': {
                    schema: ListSkillsResponseSchema,
                },
            },
        },
        500: InternalErrorResponse,
    },
});

const getSkillRoute = createRoute({
    method: 'get',
    path: '/skills/{id}',
    summary: 'Get Skill',
    description: 'Fetches the full document for a specific skill',
    tags: ['skills'],
    request: {
        params: SkillIdParamSchema,
    },
    responses: {
        200: {
            description: 'Skill document',
            content: {
                'application/json': {
                    schema: GetSkillResponseSchema,
                },
            },
        },
        404: {
            description: 'Skill not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

export function createSkillsRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const skills = await agent.skillManager.list();
            const list = skills.map(serializeSkillSummary);
            return ctx.json(ListSkillsResponseSchema.parse({ skills: list }), 200);
        })
        .openapi(getSkillRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { id } = ctx.req.valid('param');
            const skill = await agent.skillManager.get(id);
            if (!skill) {
                return ctx.json(
                    ApiErrorResponseSchema.parse({
                        message: `Skill not found: ${id}`,
                        endpoint: ctx.req.path,
                        method: ctx.req.method,
                    }),
                    404
                );
            }

            return ctx.json(
                GetSkillResponseSchema.parse({ skill: serializeSkillDocument(skill) }),
                200
            );
        });
}

type SkillIdParamInput = { param: z.input<typeof SkillIdParamSchema> };

type ListRouteSchema = OpenAPIRouteSchema<typeof listRoute, {}>;
type GetSkillRouteSchema = OpenAPIRouteSchema<typeof getSkillRoute, SkillIdParamInput>;

export type SkillsRouterSchema = ListRouteSchema | GetSkillRouteSchema;
