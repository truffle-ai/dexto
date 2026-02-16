import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';
import type { ListMemoriesOptions } from '@dexto/core';
import type { MemorySource } from '@dexto/core';

const MemorySourceSchema = z.enum(['user', 'system']);

const MemoryListInputSchema = z
    .object({
        tags: z.array(z.string()).optional().describe('Optional: filter by tags'),
        source: MemorySourceSchema.optional().describe('Optional: filter by source'),
        pinned: z.boolean().optional().describe('Optional: filter by pinned status'),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .default(50)
            .describe('Optional: limit results'),
        offset: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .default(0)
            .describe('Optional: pagination offset'),
    })
    .strict();

type MemoryListInput = z.input<typeof MemoryListInputSchema>;

export function createMemoryListTool(): Tool {
    return {
        id: 'memory_list',
        description: 'List stored memories for this agent, with optional filtering.',
        inputSchema: MemoryListInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_list requires ToolExecutionContext.agent');
            }

            const { tags, source, pinned, limit, offset } = input as MemoryListInput;

            const options: ListMemoriesOptions = {};
            if (tags !== undefined) options.tags = tags;
            if (source !== undefined) options.source = source as MemorySource;
            if (pinned !== undefined) options.pinned = pinned;
            if (limit !== undefined) options.limit = limit;
            if (offset !== undefined) options.offset = offset;

            return await agent.memoryManager.list(options);
        },
    };
}

const MemoryGetInputSchema = z.object({ id: z.string().describe('Memory ID') }).strict();
type MemoryGetInput = z.input<typeof MemoryGetInputSchema>;

export function createMemoryGetTool(): Tool {
    return {
        id: 'memory_get',
        description: 'Get a memory by ID.',
        inputSchema: MemoryGetInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_get requires ToolExecutionContext.agent');
            }

            const { id } = input as MemoryGetInput;
            return await agent.memoryManager.get(id);
        },
    };
}

const MemoryCreateInputSchema = z
    .object({
        content: z.string().min(1).describe('Memory content'),
        tags: z.array(z.string()).optional().describe('Optional: tags for categorization'),
        source: MemorySourceSchema.optional()
            .default('system')
            .describe('Memory source (default: system)'),
        pinned: z.boolean().optional().default(false).describe('Whether this memory is pinned'),
    })
    .strict();

type MemoryCreateInput = z.input<typeof MemoryCreateInputSchema>;

export function createMemoryCreateTool(): Tool {
    return {
        id: 'memory_create',
        description: 'Create a new memory.',
        inputSchema: MemoryCreateInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_create requires ToolExecutionContext.agent');
            }

            const { content, tags, source, pinned } = input as MemoryCreateInput;
            const metadata: { source?: MemorySource; pinned?: boolean } = {};
            if (source !== undefined) metadata.source = source as MemorySource;
            if (pinned !== undefined) metadata.pinned = pinned;

            return await agent.memoryManager.create({
                content,
                ...(tags !== undefined && { tags }),
                ...(Object.keys(metadata).length > 0 && { metadata }),
            });
        },
    };
}

const MemoryUpdateInputSchema = z
    .object({
        id: z.string().describe('Memory ID'),
        content: z.string().optional().describe('Updated memory content (optional)'),
        tags: z.array(z.string()).optional().describe('Updated tags (optional, replaces existing)'),
        source: MemorySourceSchema.optional().describe('Updated source (optional)'),
        pinned: z.boolean().optional().describe('Updated pinned status (optional)'),
    })
    .strict();

type MemoryUpdateInput = z.input<typeof MemoryUpdateInputSchema>;

export function createMemoryUpdateTool(): Tool {
    return {
        id: 'memory_update',
        description: 'Update an existing memory.',
        inputSchema: MemoryUpdateInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_update requires ToolExecutionContext.agent');
            }

            const { id, content, tags, source, pinned } = input as MemoryUpdateInput;
            const metadataUpdate: { source?: MemorySource; pinned?: boolean } = {};
            if (source !== undefined) metadataUpdate.source = source as MemorySource;
            if (pinned !== undefined) metadataUpdate.pinned = pinned;

            return await agent.memoryManager.update(id, {
                ...(content !== undefined && { content }),
                ...(tags !== undefined && { tags }),
                ...(Object.keys(metadataUpdate).length > 0 && { metadata: metadataUpdate }),
            });
        },
    };
}

const MemoryDeleteInputSchema = z.object({ id: z.string().describe('Memory ID') }).strict();
type MemoryDeleteInput = z.input<typeof MemoryDeleteInputSchema>;

export function createMemoryDeleteTool(): Tool {
    return {
        id: 'memory_delete',
        description: 'Delete a memory by ID.',
        inputSchema: MemoryDeleteInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_delete requires ToolExecutionContext.agent');
            }

            const { id } = input as MemoryDeleteInput;
            await agent.memoryManager.delete(id);
            return { ok: true };
        },
    };
}
