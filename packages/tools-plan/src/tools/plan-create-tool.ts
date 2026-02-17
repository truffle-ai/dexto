/**
 * Plan Create Tool
 *
 * Creates a new implementation plan for the current session.
 * Shows a preview for approval before saving.
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext, FileDisplayData } from '@dexto/core';
import type { PlanServiceGetter } from '../plan-service-getter.js';
import { PlanError } from '../errors.js';

const PlanCreateInputSchema = z
    .object({
        title: z.string().describe('Plan title (e.g., "Add User Authentication")'),
        content: z
            .string()
            .describe(
                'Plan content in markdown format. Use - [ ] and - [x] for checkboxes to track progress.'
            ),
    })
    .strict();

/**
 * Creates the plan_create tool
 */
export function createPlanCreateTool(
    getPlanService: PlanServiceGetter
): Tool<typeof PlanCreateInputSchema> {
    return defineTool({
        id: 'plan_create',
        displayName: 'Plan',
        description:
            'Create a new implementation plan for the current session. Shows the plan for approval before saving. Use markdown format for the plan content with clear steps and file references.',
        inputSchema: PlanCreateInputSchema,

        /**
         * Generate preview for approval UI
         */
        generatePreview: async (input, context: ToolExecutionContext): Promise<FileDisplayData> => {
            const { content } = input;

            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const resolvedPlanService = await getPlanService(context);

            // Check if plan already exists
            const exists = await resolvedPlanService.exists(context.sessionId);
            if (exists) {
                throw PlanError.planAlreadyExists(context.sessionId);
            }

            // Return preview for approval UI
            const lineCount = content.split('\n').length;
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);
            return {
                type: 'file',
                path: planPath,
                operation: 'create',
                content,
                size: Buffer.byteLength(content, 'utf8'),
                lineCount,
            };
        },

        async execute(input, context: ToolExecutionContext) {
            const { title, content } = input;

            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const resolvedPlanService = await getPlanService(context);

            // Keep consistent with generatePreview: fail early if plan already exists.
            // (PlanService.create also guards this, but this keeps the control flow obvious.)
            const exists = await resolvedPlanService.exists(context.sessionId);
            if (exists) {
                throw PlanError.planAlreadyExists(context.sessionId);
            }

            const plan = await resolvedPlanService.create(context.sessionId, content, { title });
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);
            const _display: FileDisplayData = {
                type: 'file',
                path: planPath,
                operation: 'create',
                size: Buffer.byteLength(content, 'utf8'),
                lineCount: content.split('\n').length,
            };

            return {
                success: true,
                path: planPath,
                status: plan.meta.status,
                title: plan.meta.title,
                _display,
            };
        },
    });
}
