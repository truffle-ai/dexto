// ============================================================================
// USER APPROVAL SCHEMAS - Zod validation schemas for approval requests/responses
// ============================================================================

import { z } from 'zod';
import type { JSONSchema7 } from 'json-schema';
import { APPROVAL_TYPES, APPROVAL_STATUSES, DENIAL_REASONS, ApprovalType } from './types.js';
import type { ToolDisplayData } from '../tools/display-types.js';
import { isValidDisplayData } from '../tools/display-types.js';
import { ToolPresentationSnapshotV1Schema } from '../tools/presentation-schema.js';
import { HostRuntimeContextSchema } from '../runtime/index.js';

// Zod schema that validates as object but types as JSONSchema7
const JsonSchema7Schema = z.record(z.string(), z.unknown()) as z.ZodType<JSONSchema7>;

/**
 * Schema for approval types
 */
export const ApprovalTypeSchema = z.enum(APPROVAL_TYPES);

/**
 * Schema for approval status
 */
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);

/**
 * Schema for denial/cancellation reasons
 */
export const DenialReasonSchema = z.enum(DENIAL_REASONS);

export const ApprovalAutoApprovalPolicySchema = z
    .enum(['allowed', 'disallowed'])
    .describe('Whether configured automatic approval may satisfy this request.');

// Custom Zod schema for ToolDisplayData validation
const ToolDisplayDataSchema = z.custom<ToolDisplayData>((val) => isValidDisplayData(val), {
    message: 'Invalid ToolDisplayData',
});

/**
 * Tool approval metadata schema
 */
export const ToolApprovalMetadataSchema = z
    .object({
        toolName: z.string().describe('Name of the tool to approve'),
        approvalKey: z
            .string()
            .min(1)
            .optional()
            .describe(
                'Optional opaque key identifying the approval scope. Core stores keys exactly and does not interpret them.'
            ),
        presentationSnapshot: ToolPresentationSnapshotV1Schema.optional().describe(
            'Optional UI-agnostic presentation snapshot for the tool call. Clients MUST ignore unknown fields.'
        ),
        toolCallId: z.string().describe('Unique tool call ID for tracking parallel tool calls'),
        args: z.record(z.string(), z.unknown()).describe('Arguments for the tool'),
        description: z.string().optional().describe('Description of the tool'),
        displayPreview: ToolDisplayDataSchema.optional().describe(
            'Preview display data for approval UI (e.g., diff preview)'
        ),
    })
    .strict()
    .describe('Tool approval metadata');

/**
 * Command approval metadata schema
 * TODO: Consider combining this with regular tools schemas for consistency
 */
export const CommandApprovalMetadataSchema = z
    .object({
        toolName: z.string().describe('Name of the tool executing the command'),
        command: z.string().describe('The normalized command to execute'),
        originalCommand: z
            .string()
            .optional()
            .describe('The original command before normalization'),
    })
    .strict()
    .describe('Command approval metadata');

/**
 * Elicitation metadata schema
 */
export const ElicitationMetadataSchema = z
    .object({
        schema: JsonSchema7Schema.describe('JSON Schema for the form'),
        prompt: z.string().describe('High-level prompt/context for the form (clients may show it)'),
        serverName: z.string().describe('MCP server requesting input'),
        context: z.record(z.string(), z.unknown()).optional().describe('Additional context'),
    })
    .strict()
    .describe('Elicitation metadata');

/**
 * Custom approval metadata schema - flexible
 */
export const CustomApprovalMetadataSchema = z
    .record(z.string(), z.unknown())
    .describe('Custom metadata');

/**
 * Base approval request schema
 */
export const BaseApprovalRequestSchema = z
    .object({
        approvalId: z.string().uuid().describe('Unique approval identifier'),
        autoApproval: ApprovalAutoApprovalPolicySchema.optional(),
        type: ApprovalTypeSchema.describe('Type of approval'),
        sessionId: z.string().optional().describe('Session identifier'),
        hostRuntime: HostRuntimeContextSchema.optional().describe(
            'Optional host-owned runtime IDs for correlating the approval flow to a single execution.'
        ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Timeout in milliseconds (optional - no timeout if not specified)'),
        timestamp: z.coerce.date().describe('When the request was created'),
    })
    .describe('Base approval request');

/**
 * Tool approval request schema
 */
export const ToolApprovalRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.TOOL_APPROVAL),
    metadata: ToolApprovalMetadataSchema,
}).strict();

/**
 * Command approval request schema
 */
export const CommandApprovalRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.COMMAND_APPROVAL),
    metadata: CommandApprovalMetadataSchema,
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
    ToolApprovalRequestSchema,
    CommandApprovalRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
]);

/**
 * Tool approval response data schema
 */
export const ToolApprovalResponseDataSchema = z
    .object({
        rememberChoice: z
            .boolean()
            .optional()
            .describe(
                'Remember this approval scope for the session. If an approval key is present, only matching keys are remembered; otherwise all uses of this tool are approved.'
            ),
    })
    .strict()
    .describe('Tool approval response data');

/**
 * Command approval response data schema
 */
export const CommandApprovalResponseDataSchema = z
    .object({
        // Command approvals don't have remember choice - they're per-command
        // Could add command pattern remembering in future (e.g., "remember git push *")
    })
    .strict()
    .describe('Command approval response data');

/**
 * Elicitation response data schema
 */
export const ElicitationResponseDataSchema = z
    .object({
        formData: z.record(z.string(), z.unknown()).describe('Form data matching schema'),
    })
    .strict()
    .describe('Elicitation response data');

/**
 * Custom approval response data schema
 */
export const CustomApprovalResponseDataSchema = z
    .record(z.string(), z.unknown())
    .describe('Custom response data');

/**
 * Base approval response schema
 */
export const BaseApprovalResponseSchema = z
    .object({
        approvalId: z.string().uuid().describe('Must match request approvalId'),
        status: ApprovalStatusSchema.describe('Approval status'),
        sessionId: z.string().optional().describe('Session identifier'),
        hostRuntime: HostRuntimeContextSchema.optional().describe(
            'Optional host-owned runtime IDs for correlating the approval flow to a single execution.'
        ),
        reason: DenialReasonSchema.optional().describe(
            'Reason for denial/cancellation (only present when status is denied or cancelled)'
        ),
        message: z
            .string()
            .optional()
            .describe('Human-readable message explaining the denial/cancellation'),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Timeout duration in milliseconds (present for timeout events)'),
    })
    .describe('Base approval response');

/**
 * Tool approval response schema
 */
export const ToolApprovalResponseSchema = BaseApprovalResponseSchema.extend({
    data: ToolApprovalResponseDataSchema.optional(),
}).strict();

/**
 * Command approval response schema
 */
export const CommandApprovalResponseSchema = BaseApprovalResponseSchema.extend({
    data: CommandApprovalResponseDataSchema.optional(),
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
    ToolApprovalResponseSchema,
    CommandApprovalResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
]);

/**
 * Approval request details schema for creating requests
 */
export const ApprovalRequestDetailsSchema = z
    .object({
        autoApproval: ApprovalAutoApprovalPolicySchema.optional(),
        type: ApprovalTypeSchema,
        sessionId: z.string().optional(),
        hostRuntime: HostRuntimeContextSchema.optional().describe(
            'Optional host-owned runtime IDs for correlating the approval flow to a single execution.'
        ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Timeout in milliseconds (optional - no timeout if not specified)'),
        metadata: z.union([
            ToolApprovalMetadataSchema,
            CommandApprovalMetadataSchema,
            ElicitationMetadataSchema,
            CustomApprovalMetadataSchema,
        ]),
    })
    .superRefine((data, ctx) => {
        // Validate metadata matches type
        if (data.type === ApprovalType.TOOL_APPROVAL) {
            const result = ToolApprovalMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'Metadata must match ToolApprovalMetadataSchema for TOOL_APPROVAL type',
                    path: ['metadata'],
                });
            }
        } else if (data.type === ApprovalType.COMMAND_APPROVAL) {
            const result = CommandApprovalMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'Metadata must match CommandApprovalMetadataSchema for COMMAND_APPROVAL type',
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
export type ValidatedToolApprovalRequest = z.output<typeof ToolApprovalRequestSchema>;
export type ValidatedElicitationRequest = z.output<typeof ElicitationRequestSchema>;
export type ValidatedCustomApprovalRequest = z.output<typeof CustomApprovalRequestSchema>;
