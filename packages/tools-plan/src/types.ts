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
 * Plan metadata stored alongside the plan content
 */
export const PlanMetaSchema = z.object({
    sessionId: z.string().describe('Session ID this plan belongs to'),
    status: PlanStatusSchema.default('draft').describe('Current plan status'),
    title: z.string().optional().describe('Plan title'),
    createdAt: z.number().describe('Unix timestamp when plan was created'),
    updatedAt: z.number().describe('Unix timestamp when plan was last updated'),
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
