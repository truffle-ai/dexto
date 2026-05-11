import { createHash } from 'crypto';
import { z } from 'zod';
import type { ToolExecutionResult } from '../../tools/types.js';
import type { ToolPresentationSnapshotV1 } from '../../tools/types.js';
import type { ToolCallMetadata } from '../../tools/tool-call-metadata.js';

export const ToolExecutionIdentitySchema = z
    .object({
        runId: z.string().min(1),
        turnId: z.string().min(1),
        modelStepId: z.string().min(1),
        toolCallId: z.string().min(1),
    })
    .strict();

const ToolExecutionResultMetadataSchema = z
    .object({
        presentationSnapshot: z.custom<ToolPresentationSnapshotV1>().optional(),
        meta: z.custom<ToolCallMetadata>().optional(),
        requireApproval: z.boolean().optional(),
        approvalStatus: z.enum(['approved', 'rejected']).optional(),
    })
    .strict();

const ToolExecutionBaseRecordSchema = z
    .object({
        executionId: z.string().min(1),
        identity: ToolExecutionIdentitySchema,
        input: z.record(z.string(), z.unknown()),
        toolName: z.string().min(1),
        startedAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    })
    .strict();

export const ToolExecutionRunningRecordSchema = ToolExecutionBaseRecordSchema.extend({
    status: z.literal('running'),
}).strict();

export const ToolExecutionCompletedRecordSchema = ToolExecutionBaseRecordSchema.extend({
    status: z.literal('completed'),
    completedAt: z.coerce.date(),
    modelOutput: z.unknown(),
    resultMetadata: ToolExecutionResultMetadataSchema.optional(),
}).strict();

export const ToolExecutionFailedRecordSchema = ToolExecutionBaseRecordSchema.extend({
    status: z.literal('failed'),
    completedAt: z.coerce.date(),
    error: z.string(),
}).strict();

export const ToolExecutionCancelledRecordSchema = ToolExecutionBaseRecordSchema.extend({
    status: z.literal('cancelled'),
    completedAt: z.coerce.date(),
    reason: z.string().optional(),
}).strict();

export const ToolExecutionRecordSchema = z.discriminatedUnion('status', [
    ToolExecutionRunningRecordSchema,
    ToolExecutionCompletedRecordSchema,
    ToolExecutionFailedRecordSchema,
    ToolExecutionCancelledRecordSchema,
]);

export type ToolExecutionIdentity = z.output<typeof ToolExecutionIdentitySchema>;
export type ToolExecutionRunningRecord = z.output<typeof ToolExecutionRunningRecordSchema>;
export type ToolExecutionCompletedRecord = z.output<typeof ToolExecutionCompletedRecordSchema>;
export type ToolExecutionFailedRecord = z.output<typeof ToolExecutionFailedRecordSchema>;
export type ToolExecutionCancelledRecord = z.output<typeof ToolExecutionCancelledRecordSchema>;
export type ToolExecutionRecord = z.output<typeof ToolExecutionRecordSchema>;
export type ToolExecutionResultMetadata = NonNullable<
    ToolExecutionCompletedRecord['resultMetadata']
>;

export type ToolExecutionStartResult =
    | { status: 'started'; record: ToolExecutionRunningRecord }
    | { status: 'existing'; record: ToolExecutionRecord };

export interface ToolExecutionStore {
    get(input: { executionId: string }): Promise<ToolExecutionRecord | undefined>;
    start(input: { record: ToolExecutionRunningRecord }): Promise<ToolExecutionStartResult>;
    complete(input: {
        executionId: string;
        completedAt: Date;
        result: ToolExecutionResult;
    }): Promise<ToolExecutionCompletedRecord>;
    fail(input: {
        executionId: string;
        completedAt: Date;
        error: string;
    }): Promise<ToolExecutionFailedRecord>;
    cancel(input: {
        executionId: string;
        completedAt: Date;
        reason?: string;
    }): Promise<ToolExecutionCancelledRecord>;
}

export function createToolExecutionId(identity: ToolExecutionIdentity): string {
    const key = JSON.stringify([
        identity.runId,
        identity.turnId,
        identity.modelStepId,
        identity.toolCallId,
    ]);
    return `tool-exec-${createHash('sha256').update(key).digest('hex')}`;
}

export function splitToolExecutionResult(result: ToolExecutionResult): {
    modelOutput: unknown;
    resultMetadata?: ToolExecutionResultMetadata;
} {
    const resultMetadata: ToolExecutionResultMetadata = {};
    if (result.presentationSnapshot !== undefined) {
        resultMetadata.presentationSnapshot = result.presentationSnapshot;
    }
    if (result.meta !== undefined) {
        resultMetadata.meta = result.meta;
    }
    if (result.requireApproval !== undefined) {
        resultMetadata.requireApproval = result.requireApproval;
    }
    if (result.approvalStatus !== undefined) {
        resultMetadata.approvalStatus = result.approvalStatus;
    }

    return {
        modelOutput: result.result,
        ...(Object.keys(resultMetadata).length > 0 ? { resultMetadata } : {}),
    };
}

export function completedToolExecutionToResult(
    record: ToolExecutionCompletedRecord
): ToolExecutionResult {
    return {
        result: record.modelOutput,
        ...(record.resultMetadata?.presentationSnapshot !== undefined
            ? { presentationSnapshot: record.resultMetadata.presentationSnapshot }
            : {}),
        ...(record.resultMetadata?.meta !== undefined ? { meta: record.resultMetadata.meta } : {}),
        ...(record.resultMetadata?.requireApproval !== undefined
            ? { requireApproval: record.resultMetadata.requireApproval }
            : {}),
        ...(record.resultMetadata?.approvalStatus !== undefined
            ? { approvalStatus: record.resultMetadata.approvalStatus }
            : {}),
    };
}
