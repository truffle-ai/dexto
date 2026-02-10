/**
 * Plan Tools Provider
 *
 * Provides implementation planning tools:
 * - plan_create: Create a new plan for the session
 * - plan_read: Read the current plan
 * - plan_update: Update the existing plan
 * - plan_review: Request user review of the plan (shows plan content with approval options)
 */

import * as path from 'node:path';
import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext, InternalTool } from '@dexto/core';
import { PlanService } from './plan-service.js';
import { createPlanCreateTool } from './tools/plan-create-tool.js';
import { createPlanReadTool } from './tools/plan-read-tool.js';
import { createPlanUpdateTool } from './tools/plan-update-tool.js';
import { createPlanReviewTool } from './tools/plan-review-tool.js';

/**
 * Available plan tool names for enabledTools configuration
 */
const PLAN_TOOL_NAMES = ['plan_create', 'plan_read', 'plan_update', 'plan_review'] as const;
type PlanToolName = (typeof PLAN_TOOL_NAMES)[number];

/**
 * Configuration schema for Plan tools provider
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

/**
 * Plan tools provider
 *
 * Provides implementation planning tools:
 * - plan_create: Create a new plan with markdown content
 * - plan_read: Read the current plan
 * - plan_update: Update existing plan (shows diff preview)
 * - plan_review: Request user review of the plan (shows plan with approval options)
 *
 * Plans are stored in .dexto/plans/{sessionId}/ with:
 * - plan.md: Markdown content with checkboxes (- [ ] and - [x])
 * - plan-meta.json: Metadata (status, title, timestamps)
 */
export const planToolsProvider: CustomToolProvider<'plan-tools', PlanToolsConfig> = {
    type: 'plan-tools',
    configSchema: PlanToolsConfigSchema,

    create: (config: PlanToolsConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger } = context;

        // Resolve base path (relative to cwd or absolute)
        const basePath = path.isAbsolute(config.basePath)
            ? config.basePath
            : path.join(process.cwd(), config.basePath);

        logger.debug(`Creating PlanService with basePath: ${basePath}`);

        const planService = new PlanService({ basePath }, logger);

        // Build tool map for selective enabling
        const toolCreators: Record<PlanToolName, () => InternalTool> = {
            plan_create: () => createPlanCreateTool(planService),
            plan_read: () => createPlanReadTool(planService),
            plan_update: () => createPlanUpdateTool(planService),
            plan_review: () => createPlanReviewTool(planService),
        };

        // Determine which tools to create
        const toolsToCreate = config.enabledTools ?? PLAN_TOOL_NAMES;

        if (config.enabledTools) {
            logger.debug(`Creating subset of plan tools: ${toolsToCreate.join(', ')}`);
        }

        // Create and return only the enabled tools
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },

    metadata: {
        displayName: 'Plan Tools',
        description: 'Create and manage implementation plans linked to sessions',
        category: 'planning',
    },
};
