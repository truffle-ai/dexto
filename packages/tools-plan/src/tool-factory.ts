import * as path from 'node:path';
import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { PlanService } from './plan-service.js';
import type { PlanServiceGetter } from './plan-service-getter.js';
import { createPlanCreateTool } from './tools/plan-create-tool.js';
import { createPlanReadTool } from './tools/plan-read-tool.js';
import { createPlanUpdateTool } from './tools/plan-update-tool.js';
import { createPlanReviewTool } from './tools/plan-review-tool.js';
import { PlanToolsConfigSchema, type PlanToolsConfig } from './tool-provider.js';
import type { InternalTool } from '@dexto/core';

const PLAN_TOOL_NAMES = ['plan_create', 'plan_read', 'plan_update', 'plan_review'] as const;
type PlanToolName = (typeof PLAN_TOOL_NAMES)[number];

export const planToolsFactory: ToolFactory<PlanToolsConfig> = {
    configSchema: PlanToolsConfigSchema,
    metadata: {
        displayName: 'Plan Tools',
        description: 'Create and manage implementation plans linked to sessions',
        category: 'planning',
    },
    create: (config) => {
        const basePath = path.isAbsolute(config.basePath)
            ? config.basePath
            : path.join(process.cwd(), config.basePath);

        let planService: PlanService | undefined;

        const getPlanService: PlanServiceGetter = async (context?: ToolExecutionContext) => {
            if (planService) {
                return planService;
            }

            planService = new PlanService({ basePath }, context?.logger);
            return planService;
        };

        const toolCreators: Record<PlanToolName, () => InternalTool> = {
            plan_create: () => createPlanCreateTool(getPlanService),
            plan_read: () => createPlanReadTool(getPlanService),
            plan_update: () => createPlanUpdateTool(getPlanService),
            plan_review: () => createPlanReviewTool(getPlanService),
        };

        const toolsToCreate = config.enabledTools ?? PLAN_TOOL_NAMES;
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },
};
