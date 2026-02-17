/**
 * Plan Read Tool
 *
 * Reads the current implementation plan for the session.
 * No approval needed - read-only operation.
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { PlanServiceGetter } from '../plan-service-getter.js';
import { PlanError } from '../errors.js';

const PlanReadInputSchema = z.object({}).strict();

/**
 * Creates the plan_read tool
 */
export function createPlanReadTool(getPlanService: PlanServiceGetter): Tool {
    return defineTool({
        id: 'plan_read',
        displayName: 'Read Plan',
        description:
            'Read the current implementation plan for this session. Returns the plan content and metadata including status. Use markdown checkboxes (- [ ] and - [x]) in the content to track progress.',
        inputSchema: PlanReadInputSchema,

        async execute(_input, context: ToolExecutionContext) {
            const resolvedPlanService = await getPlanService(context);
            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const plan = await resolvedPlanService.read(context.sessionId);

            if (!plan) {
                return {
                    exists: false,
                    message: `No plan found for this session. Use plan_create to create one.`,
                };
            }

            return {
                exists: true,
                path: resolvedPlanService.getPlanPath(context.sessionId),
                content: plan.content,
                status: plan.meta.status,
                title: plan.meta.title,
                createdAt: new Date(plan.meta.createdAt).toISOString(),
                updatedAt: new Date(plan.meta.updatedAt).toISOString(),
            };
        },
    });
}
