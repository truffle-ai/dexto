/**
 * Plan Create Tool
 *
 * Creates a new implementation plan for the current session.
 * Shows a preview for approval before saving.
 */

import { z } from 'zod';
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

type PlanCreateInput = z.input<typeof PlanCreateInputSchema>;

/**
 * Creates the plan_create tool
 */
export function createPlanCreateTool(getPlanService: PlanServiceGetter): Tool {
    return {
        id: 'plan_create',
        description:
            'Create a new implementation plan for the current session. Shows the plan for approval before saving. Use markdown format for the plan content with clear steps and file references.',
        inputSchema: PlanCreateInputSchema,

        /**
         * Generate preview for approval UI
         */
        generatePreview: async (
            input: unknown,
            context: ToolExecutionContext
        ): Promise<FileDisplayData> => {
            const resolvedPlanService = await getPlanService(context);
            const { content } = input as PlanCreateInput;

            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

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
                size: content.length,
                lineCount,
            };
        },

        execute: async (input: unknown, context: ToolExecutionContext) => {
            const resolvedPlanService = await getPlanService(context);
            const { title, content } = input as PlanCreateInput;

            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const plan = await resolvedPlanService.create(context.sessionId, content, { title });
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);

            return {
                success: true,
                path: planPath,
                status: plan.meta.status,
                title: plan.meta.title,
                _display: {
                    type: 'file',
                    path: planPath,
                    operation: 'create',
                    size: content.length,
                    lineCount: content.split('\n').length,
                } as FileDisplayData,
            };
        },
    };
}
