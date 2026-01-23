/**
 * Plan Status Tool
 *
 * Updates the plan status or checkpoint progress.
 * No approval needed - metadata-only changes.
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '@dexto/core';
import type { PlanService } from '../plan-service.js';
import { PlanError } from '../errors.js';
import { PlanStatusSchema, CheckpointStatusSchema } from '../types.js';

const PlanStatusInputSchema = z
    .object({
        status: PlanStatusSchema.optional().describe(
            'Update the overall plan status (draft, approved, in_progress, completed, abandoned)'
        ),
        checkpointId: z
            .string()
            .optional()
            .describe('Checkpoint ID to update (use with checkpointStatus)'),
        checkpointStatus: CheckpointStatusSchema.optional().describe(
            'New status for the checkpoint (pending, done, skipped)'
        ),
    })
    .strict()
    .refine(
        (data) => {
            // Either update status, or update a checkpoint, or both
            const hasStatusUpdate = data.status !== undefined;
            const hasCheckpointUpdate =
                data.checkpointId !== undefined && data.checkpointStatus !== undefined;
            const hasPartialCheckpoint =
                (data.checkpointId !== undefined) !== (data.checkpointStatus !== undefined);

            // Invalid: partial checkpoint update (one but not both)
            if (hasPartialCheckpoint) return false;

            // Valid: at least one update type
            return hasStatusUpdate || hasCheckpointUpdate;
        },
        {
            message:
                'Provide either status, or both checkpointId and checkpointStatus, or all three',
        }
    );

type PlanStatusInput = z.input<typeof PlanStatusInputSchema>;

/**
 * Creates the plan_status tool
 */
export function createPlanStatusTool(planService: PlanService): InternalTool {
    return {
        id: 'plan_status',
        description:
            'Update the plan status or mark a checkpoint as done/skipped. Use this to track progress through the implementation plan.',
        inputSchema: PlanStatusInputSchema,

        execute: async (input: unknown, context?: ToolExecutionContext) => {
            const { status, checkpointId, checkpointStatus } = input as PlanStatusInput;

            if (!context?.sessionId) {
                throw PlanError.sessionIdRequired();
            }

            // First read the current plan to verify it exists
            const existing = await planService.read(context.sessionId);
            if (!existing) {
                throw PlanError.planNotFound(context.sessionId);
            }

            let updatedMeta = existing.meta;

            // Update overall status if provided
            if (status !== undefined) {
                updatedMeta = await planService.updateMeta(context.sessionId, { status });
            }

            // Update checkpoint if provided
            if (checkpointId !== undefined && checkpointStatus !== undefined) {
                updatedMeta = await planService.updateCheckpoint(
                    context.sessionId,
                    checkpointId,
                    checkpointStatus
                );
            }

            // Calculate checkpoint summary
            const checkpoints = updatedMeta.checkpoints;
            const checkpointSummary = checkpoints
                ? {
                      total: checkpoints.length,
                      done: checkpoints.filter((cp) => cp.status === 'done').length,
                      pending: checkpoints.filter((cp) => cp.status === 'pending').length,
                      skipped: checkpoints.filter((cp) => cp.status === 'skipped').length,
                  }
                : null;

            return {
                success: true,
                path: `.dexto/plans/${context.sessionId}/plan.md`,
                status: updatedMeta.status,
                title: updatedMeta.title,
                checkpoints: checkpointSummary,
                updatedAt: new Date(updatedMeta.updatedAt).toISOString(),
            };
        },
    };
}
