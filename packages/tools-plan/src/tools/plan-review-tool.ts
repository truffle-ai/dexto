/**
 * Plan Review Tool
 *
 * Requests user review of the current plan.
 * Shows the plan content for review with approval options:
 * - Approve: Proceed with implementation
 * - Approve + Accept Edits: Proceed and auto-approve file edits
 * - Request Changes: Provide feedback for iteration
 * - Reject: Reject the plan entirely
 *
 * Uses the tool approval pattern (not elicitation) so the user
 * can see the full plan content before deciding.
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext, FileDisplayData } from '@dexto/core';
import type { PlanServiceGetter } from '../plan-service-getter.js';
import { PlanError } from '../errors.js';

const PlanReviewInputSchema = z
    .object({
        summary: z
            .string()
            .optional()
            .describe('Brief summary of the plan for context (shown above the plan content)'),
    })
    .strict();

/**
 * Creates the plan_review tool
 *
 * @param planService - Service for plan operations
 */
export function createPlanReviewTool(getPlanService: PlanServiceGetter): Tool {
    return defineTool({
        id: 'plan_review',
        displayName: 'Review Plan',
        description:
            'Request user review of the current plan. Shows the full plan content for review with options to approve, request changes, or reject. Use after creating or updating a plan to get user approval before implementation.',
        inputSchema: PlanReviewInputSchema,

        /**
         * Generate preview showing the plan content for review.
         * The ApprovalPrompt component detects plan_review and shows custom options.
         */
        generatePreview: async (input, context: ToolExecutionContext): Promise<FileDisplayData> => {
            const resolvedPlanService = await getPlanService(context);
            const { summary } = input;

            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            // Read the current plan
            const plan = await resolvedPlanService.read(context.sessionId);
            if (!plan) {
                throw PlanError.planNotFound(context.sessionId);
            }

            // Build content with optional summary header
            let displayContent = plan.content;
            if (summary) {
                displayContent = `## Summary\n${summary}\n\n---\n\n${plan.content}`;
            }

            const lineCount = displayContent.split('\n').length;
            const planPath = resolvedPlanService.getPlanPath(context.sessionId);
            return {
                type: 'file',
                path: planPath,
                operation: 'read', // 'read' indicates this is for viewing, not creating/modifying
                content: displayContent,
                size: Buffer.byteLength(displayContent, 'utf8'),
                lineCount,
            };
        },

        async execute(_input, context: ToolExecutionContext) {
            const resolvedPlanService = await getPlanService(context);
            // Tool execution means user approved the plan (selected Approve or Approve + Accept Edits)
            // Request Changes and Reject are handled as denials in the approval flow
            if (!context.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            // Read plan to verify it still exists
            const plan = await resolvedPlanService.read(context.sessionId);
            if (!plan) {
                throw PlanError.planNotFound(context.sessionId);
            }

            // Update plan status to approved
            await resolvedPlanService.updateMeta(context.sessionId, { status: 'approved' });

            return {
                approved: true,
                message: 'Plan approved. You may now proceed with implementation.',
                planStatus: 'approved',
            };
        },
    });
}
