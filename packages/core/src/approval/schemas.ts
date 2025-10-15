// ============================================================================
// USER APPROVAL SCHEMAS - Zod validation schemas for approval requests/responses
// ============================================================================

import { z } from 'zod';
import { ApprovalType, ApprovalStatus } from './types.js';

/**
 * Schema for approval types
 */
export const ApprovalTypeSchema = z.nativeEnum(ApprovalType);

/**
 * Schema for approval status
 */
export const ApprovalStatusSchema = z.nativeEnum(ApprovalStatus);

/**
 * Tool confirmation metadata schema
 */
export const ToolConfirmationMetadataSchema = z
    .object({
        toolName: z.string().describe('Name of the tool to confirm'),
        args: z.record(z.unknown()).describe('Arguments for the tool'),
        description: z.string().optional().describe('Description of the tool'),
    })
    .strict()
    .describe('Tool confirmation metadata');

/**
 * Elicitation metadata schema
 */
export const ElicitationMetadataSchema = z
    .object({
        schema: z.record(z.unknown()).describe('JSON Schema for the form'),
        prompt: z.string().describe('Prompt to show the user'),
        serverName: z.string().describe('MCP server requesting input'),
        context: z.record(z.unknown()).optional().describe('Additional context'),
    })
    .strict()
    .describe('Elicitation metadata');

/**
 * Custom approval metadata schema - flexible
 */
export const CustomApprovalMetadataSchema = z.record(z.unknown()).describe('Custom metadata');

/**
 * Base approval request schema
 */
export const BaseApprovalRequestSchema = z
    .object({
        approvalId: z.string().uuid().describe('Unique approval identifier'),
        type: ApprovalTypeSchema.describe('Type of approval'),
        sessionId: z.string().optional().describe('Session identifier'),
        timeout: z.number().int().positive().describe('Timeout in milliseconds'),
        timestamp: z.date().describe('When the request was created'),
    })
    .describe('Base approval request');

/**
 * Tool confirmation request schema
 */
export const ToolConfirmationRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.TOOL_CONFIRMATION),
    metadata: ToolConfirmationMetadataSchema,
}).strict();

/**
 * Elicitation request schema
 */
export const ElicitationRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.ELICITATION),
    metadata: ElicitationMetadataSchema,
}).strict();

/**
 * Custom approval request schema
 */
export const CustomApprovalRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.CUSTOM),
    metadata: CustomApprovalMetadataSchema,
}).strict();

/**
 * Discriminated union for all approval requests
 */
export const ApprovalRequestSchema = z.discriminatedUnion('type', [
    ToolConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
]);

/**
 * Tool confirmation response data schema
 */
export const ToolConfirmationResponseDataSchema = z
    .object({
        rememberChoice: z.boolean().optional().describe('Remember this choice'),
    })
    .strict()
    .describe('Tool confirmation response data');

/**
 * Elicitation response data schema
 */
export const ElicitationResponseDataSchema = z
    .object({
        formData: z.record(z.unknown()).describe('Form data matching schema'),
    })
    .strict()
    .describe('Elicitation response data');

/**
 * Custom approval response data schema
 */
export const CustomApprovalResponseDataSchema = z
    .record(z.unknown())
    .describe('Custom response data');

/**
 * Base approval response schema
 */
export const BaseApprovalResponseSchema = z
    .object({
        approvalId: z.string().uuid().describe('Must match request approvalId'),
        status: ApprovalStatusSchema.describe('Approval status'),
        sessionId: z.string().optional().describe('Session identifier'),
    })
    .describe('Base approval response');

/**
 * Tool confirmation response schema
 */
export const ToolConfirmationResponseSchema = BaseApprovalResponseSchema.extend({
    data: ToolConfirmationResponseDataSchema.optional(),
}).strict();

/**
 * Elicitation response schema
 */
export const ElicitationResponseSchema = BaseApprovalResponseSchema.extend({
    data: ElicitationResponseDataSchema.optional(),
}).strict();

/**
 * Custom approval response schema
 */
export const CustomApprovalResponseSchema = BaseApprovalResponseSchema.extend({
    data: CustomApprovalResponseDataSchema.optional(),
}).strict();

/**
 * Union of all approval responses
 */
export const ApprovalResponseSchema = z.union([
    ToolConfirmationResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
]);

/**
 * Approval request details schema for creating requests
 */
export const ApprovalRequestDetailsSchema = z
    .object({
        type: ApprovalTypeSchema,
        sessionId: z.string().optional(),
        timeout: z.number().int().positive(),
        metadata: z.union([
            ToolConfirmationMetadataSchema,
            ElicitationMetadataSchema,
            CustomApprovalMetadataSchema,
        ]),
    })
    .superRefine((data, ctx) => {
        // Validate metadata matches type
        if (data.type === ApprovalType.TOOL_CONFIRMATION) {
            const result = ToolConfirmationMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'Metadata must match ToolConfirmationMetadataSchema for TOOL_CONFIRMATION type',
                    path: ['metadata'],
                });
            }
        } else if (data.type === ApprovalType.ELICITATION) {
            const result = ElicitationMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Metadata must match ElicitationMetadataSchema for ELICITATION type',
                    path: ['metadata'],
                });
            }
        } else if (data.type === ApprovalType.CUSTOM) {
            const result = CustomApprovalMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Metadata must match CustomApprovalMetadataSchema for CUSTOM type',
                    path: ['metadata'],
                });
            }
        }
    });

/**
 * Type inference for validated schemas
 */
export type ValidatedApprovalRequest = z.output<typeof ApprovalRequestSchema>;
export type ValidatedApprovalResponse = z.output<typeof ApprovalResponseSchema>;
export type ValidatedToolConfirmationRequest = z.output<typeof ToolConfirmationRequestSchema>;
export type ValidatedElicitationRequest = z.output<typeof ElicitationRequestSchema>;
export type ValidatedCustomApprovalRequest = z.output<typeof CustomApprovalRequestSchema>;
