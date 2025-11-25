import { z } from 'zod';

/**
 * Memory schemas following the Zod best practices from CLAUDE.md
 */

const MAX_CONTENT_LENGTH = 10000; // 10k characters max per memory
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 10;

export const MemorySourceSchema = z.enum(['user', 'system']).describe('Source of the memory');

export const MemoryMetadataSchema = z
    .object({
        source: MemorySourceSchema.optional().describe('Source of the memory'),
        pinned: z.boolean().optional().describe('Whether this memory is pinned for auto-loading'),
    })
    .passthrough() // Allow additional custom fields
    .describe('Memory metadata');

export const MemorySchema = z
    .object({
        id: z.string().min(1).describe('Unique identifier for the memory'),
        content: z
            .string()
            .min(1, 'Memory content cannot be empty')
            .max(
                MAX_CONTENT_LENGTH,
                `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`
            )
            .describe('The actual memory content'),
        createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
        updatedAt: z.number().int().positive().describe('Last update timestamp (Unix ms)'),
        tags: z
            .array(z.string().min(1).max(MAX_TAG_LENGTH))
            .max(MAX_TAGS)
            .optional()
            .describe('Optional tags for categorization'),
        metadata: MemoryMetadataSchema.optional().describe('Additional metadata'),
    })
    .strict()
    .describe('Memory item stored in the system');

export const CreateMemoryInputSchema = z
    .object({
        content: z
            .string()
            .min(1, 'Memory content cannot be empty')
            .max(
                MAX_CONTENT_LENGTH,
                `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`
            )
            .describe('The memory content'),
        tags: z
            .array(z.string().min(1).max(MAX_TAG_LENGTH))
            .max(MAX_TAGS)
            .optional()
            .describe('Optional tags'),
        metadata: MemoryMetadataSchema.optional().describe('Optional metadata'),
    })
    .strict()
    .describe('Input for creating a new memory');

export const UpdateMemoryInputSchema = z
    .object({
        content: z
            .string()
            .min(1, 'Memory content cannot be empty')
            .max(
                MAX_CONTENT_LENGTH,
                `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`
            )
            .optional()
            .describe('Updated content'),
        tags: z
            .array(z.string().min(1).max(MAX_TAG_LENGTH))
            .max(MAX_TAGS)
            .optional()
            .describe('Updated tags (replaces existing)'),
        metadata: MemoryMetadataSchema.optional().describe(
            'Updated metadata (merges with existing)'
        ),
    })
    .strict()
    .describe('Input for updating an existing memory');

export const ListMemoriesOptionsSchema = z
    .object({
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        source: MemorySourceSchema.optional().describe('Filter by source'),
        pinned: z.boolean().optional().describe('Filter by pinned status'),
        limit: z.number().int().positive().optional().describe('Limit number of results'),
        offset: z.number().int().nonnegative().optional().describe('Skip first N results'),
    })
    .strict()
    .describe('Options for listing memories');

/**
 * Configuration schema for memory inclusion in system prompts.
 * This is a top-level agent config field that controls how memories
 * are injected into the system prompt.
 */
export const MemoriesConfigSchema = z
    .object({
        enabled: z
            .boolean()
            .default(false)
            .describe('Whether to include memories in system prompt (optional'),
        priority: z
            .number()
            .int()
            .nonnegative()
            .default(40)
            .describe('Priority in system prompt (lower = earlier)'),
        includeTimestamps: z
            .boolean()
            .default(false)
            .describe('Whether to include timestamps in memory display'),
        includeTags: z
            .boolean()
            .default(true)
            .describe('Whether to include tags in memory display'),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum number of memories to include'),
        pinnedOnly: z.boolean().default(false).describe('Only include pinned memories'),
    })
    .strict()
    .describe('Memory configuration for system prompt inclusion');

export type ValidatedMemory = z.output<typeof MemorySchema>;
export type ValidatedCreateMemoryInput = z.output<typeof CreateMemoryInputSchema>;
export type ValidatedUpdateMemoryInput = z.output<typeof UpdateMemoryInputSchema>;
export type ValidatedListMemoriesOptions = z.output<typeof ListMemoriesOptionsSchema>;
export type MemoriesConfig = z.input<typeof MemoriesConfigSchema>;
export type ValidatedMemoriesConfig = z.output<typeof MemoriesConfigSchema>;
