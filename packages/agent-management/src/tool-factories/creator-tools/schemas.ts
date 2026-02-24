import { z } from 'zod';

export const CREATOR_TOOL_NAMES = [
    'skill_create',
    'skill_update',
    'skill_search',
    'skill_list',
    'tool_catalog',
] as const;

export type CreatorToolName = (typeof CREATOR_TOOL_NAMES)[number];

export const CreatorToolsConfigSchema = z
    .object({
        type: z.literal('creator-tools'),
        enabledTools: z
            .array(z.enum(CREATOR_TOOL_NAMES))
            .optional()
            .describe('Subset of creator tools to enable'),
    })
    .strict();

export type CreatorToolsConfig = z.output<typeof CreatorToolsConfigSchema>;
