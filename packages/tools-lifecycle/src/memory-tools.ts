import { z } from 'zod';
import { ToolError, defineTool } from '@dexto/core';
import type { ListMemoriesOptions, MemorySource, Tool, ToolExecutionContext } from '@dexto/core';

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
export function createMemoryListTool(): Tool {
    return defineTool({
        id: 'memory_list',
        displayName: 'List Memories',
        description: 'List stored memories for this agent, with optional filtering.',
        inputSchema: MemoryListInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_list requires ToolExecutionContext.agent');
            }

            const { tags, source, pinned, limit, offset } = input;

            const options: ListMemoriesOptions = {
                limit,
                offset,
                ...(tags !== undefined && { tags }),
                ...(source !== undefined && { source }),
                ...(pinned !== undefined && { pinned }),
            };

            return await agent.memoryManager.list(options);
        },
    });
}

const MemoryGetInputSchema = z.object({ id: z.string().describe('Memory ID') }).strict();

export function createMemoryGetTool(): Tool {
    return defineTool({
        id: 'memory_get',
        displayName: 'Get Memory',
        description: 'Get a memory by ID.',
        inputSchema: MemoryGetInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_get requires ToolExecutionContext.agent');
            }

            const { id } = input;
            return await agent.memoryManager.get(id);
        },
    });
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
export function createMemoryCreateTool(): Tool {
    return defineTool({
        id: 'memory_create',
        displayName: 'Create Memory',
        description: 'Create a new memory.',
        inputSchema: MemoryCreateInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_create requires ToolExecutionContext.agent');
            }

            const { content, tags, source, pinned } = input;
            const metadata: { source: MemorySource; pinned?: boolean } = { source };
            if (pinned) metadata.pinned = true;

            return await agent.memoryManager.create({
                content,
                ...(tags !== undefined && { tags }),
                metadata,
            });
        },
    });
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
export function createMemoryUpdateTool(): Tool {
    return defineTool({
        id: 'memory_update',
        displayName: 'Update Memory',
        description: 'Update an existing memory.',
        inputSchema: MemoryUpdateInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_update requires ToolExecutionContext.agent');
            }

            const { id, content, tags, source, pinned } = input;
            const metadataUpdate: { source?: MemorySource; pinned?: boolean } = {};
            if (source !== undefined) metadataUpdate.source = source;
            if (pinned !== undefined) metadataUpdate.pinned = pinned;

            return await agent.memoryManager.update(id, {
                ...(content !== undefined && { content }),
                ...(tags !== undefined && { tags }),
                ...(Object.keys(metadataUpdate).length > 0 && { metadata: metadataUpdate }),
            });
        },
    });
}

const MemoryDeleteInputSchema = z.object({ id: z.string().describe('Memory ID') }).strict();

export function createMemoryDeleteTool(): Tool {
    return defineTool({
        id: 'memory_delete',
        displayName: 'Delete Memory',
        description: 'Delete a memory by ID.',
        inputSchema: MemoryDeleteInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                throw ToolError.configInvalid('memory_delete requires ToolExecutionContext.agent');
            }

            const { id } = input;
            await agent.memoryManager.delete(id);
            return { ok: true };
        },
    });
}
