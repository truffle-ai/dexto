/**
 * Plan Tools Factory
 *
 * Provides implementation planning tools:
 * - plan_create: Create a new plan for the session
 * - plan_read: Read the current plan
 * - plan_update: Update the existing plan
 * - plan_review: Request user review of the plan (shows plan content with approval options)
 */

import { z } from 'zod';

/**
 * Available plan tool names for enabledTools configuration
 */
export const PLAN_TOOL_NAMES = ['plan_create', 'plan_read', 'plan_update', 'plan_review'] as const;

/**
 * Configuration schema for Plan tools factory
 */
export const PlanToolsConfigSchema = z
    .object({
        type: z.literal('plan-tools'),
        basePath: z
            .string()
            .default('.dexto/plans')
            .describe('Base directory for plan storage (relative to working directory)'),
        enabledTools: z
            .array(z.enum(PLAN_TOOL_NAMES))
            .optional()
            .describe(
                `Subset of tools to enable. If not specified, all tools are enabled. Available: ${PLAN_TOOL_NAMES.join(', ')}`
            ),
    })
    .strict();

export type PlanToolsConfig = z.output<typeof PlanToolsConfigSchema>;
