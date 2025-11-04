import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import type { CreateMemoryInput, UpdateMemoryInput, ListMemoriesOptions } from '@dexto/core';
import { CreateMemoryInputSchema, UpdateMemoryInputSchema } from '@dexto/core';

// Schema for memory ID parameter
const MemoryIdParamsSchema = z.object({
    id: z.string().min(1, 'Memory ID is required'),
});

// Schema for list query parameters (from query string)
const ListMemoriesQuerySchema = z.object({
    tags: z
        .string()
        .optional()
        .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
    source: z.enum(['user', 'system']).optional(),
    pinned: z
        .string()
        .optional()
        .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
    limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined)),
    offset: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined)),
});

/**
 * Setup memory API routes
 * Provides CRUD operations for user memories
 *
 * Uses a getter function to ensure memory operations always use the current agent,
 * even after agent switches in web/server modes.
 *
 * Routes:
 * - POST /api/memory - Create a new memory
 * - GET /api/memory - List all memories (with optional filters)
 * - GET /api/memory/:id - Get a specific memory
 * - PUT /api/memory/:id - Update a memory
 * - DELETE /api/memory/:id - Delete a memory
 */
export function setupMemoryRoutes(getAgent: () => DextoAgent): Router {
    const router = Router();

    // Create a new memory
    router.post('/', express.json(), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const input = CreateMemoryInputSchema.parse(req.body) as CreateMemoryInput;
            const memory = await getAgent().memoryManager.create(input);
            return res.status(201).json({ ok: true, memory });
        } catch (error) {
            return next(error);
        }
    });

    // List all memories with optional filtering
    router.get('/', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const agent = getAgent();
            const queryOptions = ListMemoriesQuerySchema.parse(req.query);
            // Build options object, removing undefined values
            const options: ListMemoriesOptions = {};
            if (queryOptions.tags !== undefined) options.tags = queryOptions.tags;
            if (queryOptions.source !== undefined) options.source = queryOptions.source;
            if (queryOptions.pinned !== undefined) options.pinned = queryOptions.pinned;
            if (queryOptions.limit !== undefined) options.limit = queryOptions.limit;
            if (queryOptions.offset !== undefined) options.offset = queryOptions.offset;

            const memories = await agent.memoryManager.list(options);
            return res.status(200).json({ ok: true, memories, count: memories.length });
        } catch (error) {
            return next(error);
        }
    });

    // Get memory count (with optional filtering)
    // NOTE: Must be declared before /:id route to avoid route shadowing
    router.get('/count', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const agent = getAgent();
            const queryOptions = ListMemoriesQuerySchema.parse(req.query);
            const options: ListMemoriesOptions = {};
            if (queryOptions.tags !== undefined) options.tags = queryOptions.tags;
            if (queryOptions.source !== undefined) options.source = queryOptions.source;
            if (queryOptions.pinned !== undefined) options.pinned = queryOptions.pinned;

            const count = await agent.memoryManager.count(options);
            return res.status(200).json({ ok: true, count });
        } catch (error) {
            return next(error);
        }
    });

    // Get a specific memory by ID
    router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const agent = getAgent();
            const { id } = MemoryIdParamsSchema.parse(req.params);
            const memory = await agent.memoryManager.get(id);
            return res.status(200).json({ ok: true, memory });
        } catch (error) {
            return next(error);
        }
    });

    // Update a memory
    router.put('/:id', express.json(), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const agent = getAgent();
            const { id } = MemoryIdParamsSchema.parse(req.params);
            const updates = UpdateMemoryInputSchema.parse(req.body) as UpdateMemoryInput;
            const memory = await agent.memoryManager.update(id, updates);
            return res.status(200).json({ ok: true, memory });
        } catch (error) {
            return next(error);
        }
    });

    // Delete a memory
    router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const agent = getAgent();
            const { id } = MemoryIdParamsSchema.parse(req.params);
            await agent.memoryManager.delete(id);
            return res.status(200).json({ ok: true, message: 'Memory deleted successfully' });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
