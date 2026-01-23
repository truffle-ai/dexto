/**
 * Plan Create Tool
 *
 * Creates a new implementation plan for the current session.
 * Shows a preview for approval before saving.
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext, FileDisplayData } from '@dexto/core';
import type { PlanService } from '../plan-service.js';
import { PlanError } from '../errors.js';

const PlanCreateInputSchema = z
    .object({
        title: z.string().describe('Plan title (e.g., "Add User Authentication")'),
        content: z.string().describe('Plan content in markdown format'),
        checkpoints: z
            .array(
                z.object({
                    id: z.string().describe('Unique checkpoint identifier'),
                    description: z.string().describe('What this checkpoint represents'),
                })
            )
            .optional()
            .describe('Optional checkpoints to track progress'),
    })
    .strict();

type PlanCreateInput = z.input<typeof PlanCreateInputSchema>;

/**
 * Creates the plan_create tool
 */
export function createPlanCreateTool(planService: PlanService): InternalTool {
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
            context?: ToolExecutionContext
        ): Promise<FileDisplayData> => {
            const { content } = input as PlanCreateInput;

            if (!context?.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            // Check if plan already exists
            const exists = await planService.exists(context.sessionId);
            if (exists) {
                throw PlanError.planAlreadyExists(context.sessionId);
            }

            // Return preview for approval UI
            const lineCount = content.split('\n').length;
            return {
                type: 'file',
                path: `.dexto/plans/${context.sessionId}/plan.md`,
                operation: 'create',
                content,
                size: content.length,
                lineCount,
            };
        },

        execute: async (input: unknown, context?: ToolExecutionContext) => {
            const { title, content, checkpoints } = input as PlanCreateInput;

            if (!context?.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            const plan = await planService.create(
                context.sessionId,
                content,
                checkpoints ? { title, checkpoints } : { title }
            );

            return {
                success: true,
                path: `.dexto/plans/${context.sessionId}/plan.md`,
                status: plan.meta.status,
                title: plan.meta.title,
                checkpoints: plan.meta.checkpoints?.length ?? 0,
                _display: {
                    type: 'file',
                    path: `.dexto/plans/${context.sessionId}/plan.md`,
                    operation: 'create',
                    size: content.length,
                    lineCount: content.split('\n').length,
                } as FileDisplayData,
            };
        },
    };
}
