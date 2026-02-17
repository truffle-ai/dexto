import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { WorkspaceSchema } from '../schemas/responses.js';
import type { GetAgentFn } from '../index.js';

const SetWorkspaceSchema = z
    .object({
        path: z.string().min(1).describe('Absolute workspace root path'),
        name: z.string().optional().describe('Optional workspace display name'),
    })
    .strict()
    .describe('Request body for setting the active workspace');

export function createWorkspacesRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/workspaces',
        summary: 'List Workspaces',
        description: 'Retrieves all known workspaces',
        tags: ['workspaces'],
        responses: {
            200: {
                description: 'List of workspaces',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                workspaces: z.array(WorkspaceSchema).describe('Workspace list'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const getActiveRoute = createRoute({
        method: 'get',
        path: '/workspaces/active',
        summary: 'Get Active Workspace',
        description: 'Returns the active workspace, if any',
        tags: ['workspaces'],
        responses: {
            200: {
                description: 'Active workspace',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                workspace: WorkspaceSchema.nullable().describe(
                                    'Active workspace or null if none is set'
                                ),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const setActiveRoute = createRoute({
        method: 'post',
        path: '/workspaces/active',
        summary: 'Set Active Workspace',
        description: 'Sets the active workspace for this runtime',
        tags: ['workspaces'],
        request: { body: { content: { 'application/json': { schema: SetWorkspaceSchema } } } },
        responses: {
            200: {
                description: 'Active workspace updated',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                workspace: WorkspaceSchema.describe('Updated active workspace'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const clearActiveRoute = createRoute({
        method: 'delete',
        path: '/workspaces/active',
        summary: 'Clear Active Workspace',
        description: 'Clears the active workspace for this runtime',
        tags: ['workspaces'],
        responses: {
            200: {
                description: 'Active workspace cleared',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                workspace: WorkspaceSchema.nullable().describe(
                                    'Active workspace or null if none is set'
                                ),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const workspaces = await agent.listWorkspaces();
            return ctx.json({ workspaces });
        })
        .openapi(getActiveRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const workspace = await agent.getWorkspace();
            return ctx.json({ workspace: workspace ?? null });
        })
        .openapi(setActiveRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const input = ctx.req.valid('json');
            const workspaceInput =
                input.name === undefined
                    ? { path: input.path }
                    : { path: input.path, name: input.name };
            const workspace = await agent.setWorkspace(workspaceInput);
            return ctx.json({ workspace });
        })
        .openapi(clearActiveRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            await agent.clearWorkspace();
            return ctx.json({ workspace: null });
        });
}
