/**
 * Plan Types and Schemas
 *
 * Defines the structure of plans and their metadata.
 */

import { z } from 'zod';

/**
 * Plan status values
 */
export const PlanStatusSchema = z.enum([
    'draft',
    'approved',
    'in_progress',
    'completed',
    'abandoned',
]);

export type PlanStatus = z.infer<typeof PlanStatusSchema>;

/**
 * Checkpoint status values
 */
export const CheckpointStatusSchema = z.enum(['pending', 'done', 'skipped']);

export type CheckpointStatus = z.infer<typeof CheckpointStatusSchema>;

/**
 * A checkpoint within a plan
 */
export const CheckpointSchema = z.object({
    id: z.string().describe('Unique identifier for the checkpoint'),
    description: z.string().describe('What this checkpoint represents'),
    status: CheckpointStatusSchema.default('pending').describe('Current status of the checkpoint'),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

/**
 * Plan metadata stored alongside the plan content
 */
export const PlanMetaSchema = z.object({
    sessionId: z.string().describe('Session ID this plan belongs to'),
    status: PlanStatusSchema.default('draft').describe('Current plan status'),
    title: z.string().optional().describe('Plan title'),
    createdAt: z.number().describe('Unix timestamp when plan was created'),
    updatedAt: z.number().describe('Unix timestamp when plan was last updated'),
    checkpoints: z.array(CheckpointSchema).optional().describe('Trackable milestones'),
});

export type PlanMeta = z.infer<typeof PlanMetaSchema>;

/**
 * Complete plan with content and metadata
 */
export interface Plan {
    content: string;
    meta: PlanMeta;
}

/**
 * Options for the plan service
 */
export interface PlanServiceOptions {
    /** Base directory for plan storage */
    basePath: string;
}

/**
 * Result of a plan update operation
 */
export interface PlanUpdateResult {
    oldContent: string;
    newContent: string;
    meta: PlanMeta;
}
