import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import type { Context } from 'hono';

type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const MAX_SYSTEM_PROMPT_CONTRIBUTOR_CONTENT_CHARS = 120000;
const DEFAULT_SYSTEM_PROMPT_CONTRIBUTOR_PRIORITY = 45;

const ContributorInfoSchema = z
    .object({
        id: z.string().describe('Contributor identifier'),
        priority: z.number().describe('Contributor priority'),
    })
    .strict()
    .describe('System prompt contributor metadata.');

const UpsertSystemPromptContributorSchema = z
    .object({
        id: z.string().min(1).describe('Contributor identifier'),
        priority: z.number().optional().describe('Optional priority override'),
        enabled: z
            .boolean()
            .optional()
            .describe('Set false to remove the contributor instead of adding/updating it'),
        content: z
            .string()
            .optional()
            .describe('Static contributor content. Empty content removes the contributor.'),
    })
    .strict()
    .describe('System prompt contributor update payload.');

const SystemPromptContributorErrorSchema = z
    .object({
        error: z.string().describe('Error message'),
    })
    .strict()
    .describe('System prompt contributor error response.');

function sanitizeContributorId(value: string): string {
    return value
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function resolveContributorPriority(value: number | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    return DEFAULT_SYSTEM_PROMPT_CONTRIBUTOR_PRIORITY;
}

export function createSystemPromptRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const listContributorsRoute = createRoute({
        method: 'get',
        path: '/system-prompt/contributors',
        summary: 'List System Prompt Contributors',
        description: 'Lists currently registered system prompt contributors.',
        tags: ['config'],
        responses: {
            200: {
                description: 'Current contributor list',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                contributors: z
                                    .array(ContributorInfoSchema)
                                    .describe('Registered system prompt contributors.'),
                            })
                            .strict()
                            .describe('System prompt contributors list response.'),
                    },
                },
            },
        },
    });

    const upsertContributorRoute = createRoute({
        method: 'post',
        path: '/system-prompt/contributors',
        summary: 'Upsert System Prompt Contributor',
        description:
            'Adds or updates a static system prompt contributor. Set enabled=false (or empty content) to remove.',
        tags: ['config'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: UpsertSystemPromptContributorSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Contributor upsert result',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                id: z.string().describe('Contributor identifier'),
                                enabled: z
                                    .boolean()
                                    .describe('Whether the contributor remains enabled'),
                                priority: z.number().optional().describe('Contributor priority'),
                                replaced: z
                                    .boolean()
                                    .optional()
                                    .describe('Whether an existing contributor was replaced'),
                                removed: z
                                    .boolean()
                                    .optional()
                                    .describe('Whether the contributor was removed'),
                                contentLength: z
                                    .number()
                                    .optional()
                                    .describe('Stored content length in characters'),
                                truncated: z
                                    .boolean()
                                    .optional()
                                    .describe('Whether the submitted content was truncated'),
                            })
                            .strict()
                            .describe('System prompt contributor upsert response.'),
                    },
                },
            },
            400: {
                description: 'Invalid contributor update request',
                content: {
                    'application/json': {
                        schema: SystemPromptContributorErrorSchema,
                    },
                },
            },
        },
    });

    return app
        .openapi(listContributorsRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const contributors = agent.systemPromptManager.getContributors().map((contributor) => ({
                id: contributor.id,
                priority: contributor.priority,
            }));
            return ctx.json({ contributors });
        })
        .openapi(upsertContributorRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const payload = ctx.req.valid('json');

            const contributorId = sanitizeContributorId(payload.id);
            if (contributorId.length === 0) {
                return ctx.json({ error: 'A valid contributor id is required' }, 400);
            }

            const enabled = payload.enabled !== false;
            const rawContent = payload.content ?? '';
            const content = rawContent.slice(0, MAX_SYSTEM_PROMPT_CONTRIBUTOR_CONTENT_CHARS);
            const priority = resolveContributorPriority(payload.priority);

            const replaced = agent.systemPromptManager.removeContributor(contributorId);
            if (!enabled || content.trim().length === 0) {
                return ctx.json(
                    {
                        id: contributorId,
                        enabled: false,
                        removed: replaced,
                    },
                    200
                );
            }

            agent.systemPromptManager.addContributor({
                id: contributorId,
                priority,
                getContent: async () => content,
            });

            return ctx.json(
                {
                    id: contributorId,
                    enabled: true,
                    priority,
                    replaced,
                    contentLength: content.length,
                    truncated: rawContent.length > content.length,
                },
                200
            );
        });
}
