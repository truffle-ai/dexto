/**
 * Plan Read Tool
 *
 * Reads the current implementation plan for the session.
 * No approval needed - read-only operation.
 */

import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { PlanService } from '../plan-service.js';
import type { PlanServiceGetter } from '../plan-service-getter.js';
import { PlanError } from '../errors.js';

const PlanReadInputSchema = z.object({}).strict();

/**
 * Creates the plan_read tool
 */
export function createPlanReadTool(planService: PlanService | PlanServiceGetter): Tool {
    const getPlanService: PlanServiceGetter =
        typeof planService === 'function' ? planService : async () => planService;

    return {
        id: 'plan_read',
        description:
            'Read the current implementation plan for this session. Returns the plan content and metadata including status. Use markdown checkboxes (- [ ] and - [x]) in the content to track progress.',
        inputSchema: PlanReadInputSchema,

        execute: async (_input: unknown, context?: ToolExecutionContext) => {
            const resolvedPlanService = await getPlanService(context);
            if (!context?.sessionId) {
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
    };
}
