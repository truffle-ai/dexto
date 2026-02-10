/**
 * Plan Update Tool
 *
 * Updates the implementation plan for the current session.
 * Shows a diff preview for approval before saving.
 */

import { z } from 'zod';
import { createPatch } from 'diff';
import type { InternalTool, ToolExecutionContext, DiffDisplayData } from '@dexto/core';
import type { PlanService } from '../plan-service.js';
import type { PlanServiceGetter } from '../plan-service-getter.js';
import { PlanError } from '../errors.js';

const PlanUpdateInputSchema = z
    .object({
        content: z.string().describe('Updated plan content in markdown format'),
    })
    .strict();

type PlanUpdateInput = z.input<typeof PlanUpdateInputSchema>;

/**
 * Generate diff preview for plan update
 */
function generateDiffPreview(
    filePath: string,
    originalContent: string,
    newContent: string
): DiffDisplayData {
    const unified = createPatch(filePath, originalContent, newContent, 'before', 'after', {
        context: 3,
    });
    const additions = (unified.match(/^\+[^+]/gm) || []).length;
    const deletions = (unified.match(/^-[^-]/gm) || []).length;

    return {
        type: 'diff',
        unified,
        filename: filePath,
        additions,
        deletions,
    };
}

/**
 * Creates the plan_update tool
 */
export function createPlanUpdateTool(planService: PlanService | PlanServiceGetter): InternalTool {
    const getPlanService: PlanServiceGetter =
        typeof planService === 'function' ? planService : async () => planService;

    return {
        id: 'plan_update',
        description:
            'Update the existing implementation plan for this session. Shows a diff preview for approval before saving. The plan must already exist (use plan_create first).',
        inputSchema: PlanUpdateInputSchema,

        /**
         * Generate diff preview for approval UI
         */
        generatePreview: async (
            input: unknown,
            context?: ToolExecutionContext
        ): Promise<DiffDisplayData> => {
            const resolvedPlanService = await getPlanService(context);
            const { content: newContent } = input as PlanUpdateInput;

            if (!context?.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            // Read existing plan
            const existing = await resolvedPlanService.read(context.sessionId);
            if (!existing) {
                throw PlanError.planNotFound(context.sessionId);
            }

            // Generate diff preview
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);
            return generateDiffPreview(planPath, existing.content, newContent);
        },

        execute: async (input: unknown, context?: ToolExecutionContext) => {
            const resolvedPlanService = await getPlanService(context);
            const { content } = input as PlanUpdateInput;

            if (!context?.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const result = await resolvedPlanService.update(context.sessionId, content);
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);

            return {
                success: true,
                path: planPath,
                status: result.meta.status,
                _display: generateDiffPreview(planPath, result.oldContent, result.newContent),
            };
        },
    };
}
