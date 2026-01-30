import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { CreateMemoryInputSchema, UpdateMemoryInputSchema } from '@dexto/core';
import { MemorySchema } from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const MemoryIdParamSchema = z
    .object({
        id: z.string().min(1, 'Memory ID is required').describe('Memory unique identifier'),
    })
    .describe('Path parameters for memory endpoints');

const ListMemoriesQuerySchema = z
    .object({
        tags: z
            .string()
            .optional()
            .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined))
            .describe('Comma-separated list of tags to filter by'),
        source: z.enum(['user', 'system']).optional().describe('Filter by source (user or system)'),
        pinned: z
            .string()
            .optional()
            .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined))
            .describe('Filter by pinned status (true or false)'),
        limit: z
            .string()
            .optional()
            .transform((val) => (val ? parseInt(val, 10) : undefined))
            .describe('Maximum number of memories to return'),
        offset: z
            .string()
            .optional()
            .transform((val) => (val ? parseInt(val, 10) : undefined))
            .describe('Number of memories to skip'),
    })
    .describe('Query parameters for listing and filtering memories');

// Response schemas
const MemoryResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful response'),
        memory: MemorySchema.describe('The created or retrieved memory'),
    })
    .strict()
    .describe('Single memory response');

const MemoriesListResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful response'),
        memories: z.array(MemorySchema).describe('List of memories'),
    })
    .strict()
    .describe('Multiple memories response');

const MemoryDeleteResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful response'),
        message: z.string().describe('Deletion confirmation message'),
    })
    .strict()
    .describe('Memory deletion response');

export function createMemoryRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const createMemoryRoute = createRoute({
        method: 'post',
        path: '/memory',
        summary: 'Create Memory',
        description: 'Creates a new memory',
        tags: ['memory'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: CreateMemoryInputSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Memory created',
                content: { 'application/json': { schema: MemoryResponseSchema } },
            },
        },
    });

    const listRoute = createRoute({
        method: 'get',
        path: '/memory',
        summary: 'List Memories',
        description: 'Retrieves a list of all memories with optional filtering',
        tags: ['memory'],
        request: { query: ListMemoriesQuerySchema },
        responses: {
            200: {
                description: 'List memories',
                content: { 'application/json': { schema: MemoriesListResponseSchema } },
            },
        },
    });

    const getRoute = createRoute({
        method: 'get',
        path: '/memory/{id}',
        summary: 'Get Memory by ID',
        description: 'Retrieves a specific memory by its unique identifier',
        tags: ['memory'],
        request: {
            params: MemoryIdParamSchema,
        },
        responses: {
            200: {
                description: 'Memory details',
                content: { 'application/json': { schema: MemoryResponseSchema } },
            },
        },
    });

    const updateRoute = createRoute({
        method: 'put',
        path: '/memory/{id}',
        summary: 'Update Memory',
        description: 'Updates an existing memory. Only provided fields will be updated',
        tags: ['memory'],
        request: {
            params: MemoryIdParamSchema,
            body: {
                content: {
                    'application/json': {
                        schema: UpdateMemoryInputSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Memory updated',
                content: { 'application/json': { schema: MemoryResponseSchema } },
            },
        },
    });

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/memory/{id}',
        summary: 'Delete Memory',
        description: 'Permanently deletes a memory. This action cannot be undone',
        tags: ['memory'],
        request: {
            params: MemoryIdParamSchema,
        },
        responses: {
            200: {
                description: 'Memory deleted',
                content: { 'application/json': { schema: MemoryDeleteResponseSchema } },
            },
        },
    });

    return app
        .openapi(createMemoryRoute, async (ctx) => {
            const input = ctx.req.valid('json');

            // Filter out undefined values for exactOptionalPropertyTypes compatibility
            const createInput: {
                content: string;
                tags?: string[];
                metadata?: Record<string, unknown>;
            } = {
                content: input.content,
            };
            if (input.tags !== undefined && Array.isArray(input.tags)) {
                createInput.tags = input.tags;
            }
            if (input.metadata !== undefined) {
                createInput.metadata = input.metadata;
            }
            const agent = await getAgent(ctx);
            const memory = await agent.memoryManager.create(createInput);
            return ctx.json({ ok: true as const, memory }, 201);
        })
        .openapi(listRoute, async (ctx) => {
            const query = ctx.req.valid('query');
            const options: {
                tags?: string[];
                source?: 'user' | 'system';
                pinned?: boolean;
                limit?: number;
                offset?: number;
            } = {};
            if (query.tags !== undefined) options.tags = query.tags;
            if (query.source !== undefined) options.source = query.source;
            if (query.pinned !== undefined) options.pinned = query.pinned;
            if (query.limit !== undefined) options.limit = query.limit;
            if (query.offset !== undefined) options.offset = query.offset;

            const agent = await getAgent(ctx);
            const memories = await agent.memoryManager.list(options);
            return ctx.json({ ok: true as const, memories });
        })
        .openapi(getRoute, async (ctx) => {
            const { id } = ctx.req.valid('param');
            const agent = await getAgent(ctx);
            const memory = await agent.memoryManager.get(id);
            return ctx.json({ ok: true as const, memory });
        })
        .openapi(updateRoute, async (ctx) => {
            const { id } = ctx.req.valid('param');
            const updatesRaw = ctx.req.valid('json');
            // Build updates object only with defined properties for exactOptionalPropertyTypes
            const updates: {
                content?: string;
                metadata?: Record<string, unknown>;
                tags?: string[];
            } = {};
            if (updatesRaw.content !== undefined) updates.content = updatesRaw.content;
            if (updatesRaw.metadata !== undefined) updates.metadata = updatesRaw.metadata;
            if (updatesRaw.tags !== undefined) updates.tags = updatesRaw.tags;
            const agent = await getAgent(ctx);
            const memory = await agent.memoryManager.update(id, updates);
            return ctx.json({ ok: true as const, memory });
        })
        .openapi(deleteRoute, async (ctx) => {
            const { id } = ctx.req.valid('param');
            const agent = await getAgent(ctx);
            await agent.memoryManager.delete(id);
            return ctx.json({ ok: true as const, message: 'Memory deleted successfully' });
        });
}
