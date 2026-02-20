// ============================================================================
// USER APPROVAL SCHEMAS - Zod validation schemas for approval requests/responses
// ============================================================================

import { z } from 'zod';
import type { JSONSchema7 } from 'json-schema';
import { ApprovalType, ApprovalStatus, DenialReason } from './types.js';
import type { ToolDisplayData } from '../tools/display-types.js';
import { isValidDisplayData } from '../tools/display-types.js';
import type { ToolPresentationSnapshotV1 } from '../tools/types.js';

// Zod schema that validates as object but types as JSONSchema7
const JsonSchema7Schema = z.record(z.unknown()) as z.ZodType<JSONSchema7>;

/**
 * Schema for approval types
 */
export const ApprovalTypeSchema = z.nativeEnum(ApprovalType);

/**
 * Schema for approval status
 */
export const ApprovalStatusSchema = z.nativeEnum(ApprovalStatus);

/**
 * Schema for denial/cancellation reasons
 */
export const DenialReasonSchema = z.nativeEnum(DenialReason);

// Custom Zod schema for ToolDisplayData validation
const ToolDisplayDataSchema = z.custom<ToolDisplayData>((val) => isValidDisplayData(val), {
    message: 'Invalid ToolDisplayData',
});

const ToolPresentationSnapshotV1Schema = z.custom<ToolPresentationSnapshotV1>(
    (val) =>
        typeof val === 'object' && val !== null && (val as { version?: unknown }).version === 1,
    {
        message: 'Invalid ToolPresentationSnapshotV1',
    }
);

/**
 * Directory access metadata schema
 * Used when a tool tries to access files outside the working directory
 */
export const DirectoryAccessMetadataSchema = z
    .object({
        path: z.string().describe('Full path being accessed'),
        parentDir: z.string().describe('Parent directory (what gets approved for session)'),
        operation: z.enum(['read', 'write', 'edit']).describe('Type of file operation'),
        toolName: z.string().describe('Name of the tool requesting access'),
    })
    .strict()
    .describe('Directory access metadata');

/**
 * Tool approval metadata schema
 */
export const ToolApprovalMetadataSchema = z
    .object({
        toolName: z.string().describe('Name of the tool to confirm'),
        presentationSnapshot: ToolPresentationSnapshotV1Schema.optional().describe(
            'Optional UI-agnostic presentation snapshot for the tool call. Clients MUST ignore unknown fields.'
        ),
        toolCallId: z.string().describe('Unique tool call ID for tracking parallel tool calls'),
        args: z.record(z.unknown()).describe('Arguments for the tool'),
        description: z.string().optional().describe('Description of the tool'),
        displayPreview: ToolDisplayDataSchema.optional().describe(
            'Preview display data for approval UI (e.g., diff preview)'
        ),
        directoryAccess: DirectoryAccessMetadataSchema.optional().describe(
            'Optional directory access metadata when the tool targets a path outside config-allowed roots'
        ),
        suggestedPatterns: z
            .array(z.string())
            .optional()
            .describe(
                'Suggested patterns for session approval. ' +
                    'Tools may provide patterns to allow approving a broader subset of future calls (e.g., ["git push *", "git *"]).'
            ),
    })
    .strict()
    .describe('Tool approval metadata');

/**
 * Command confirmation metadata schema
 * TODO: Consider combining this with regular tools schemas for consistency
 */
export const CommandConfirmationMetadataSchema = z
    .object({
        toolName: z.string().describe('Name of the tool executing the command'),
        command: z.string().describe('The normalized command to execute'),
        originalCommand: z
            .string()
            .optional()
            .describe('The original command before normalization'),
    })
    .strict()
    .describe('Command confirmation metadata');

/**
 * Elicitation metadata schema
 */
export const ElicitationMetadataSchema = z
    .object({
        schema: JsonSchema7Schema.describe('JSON Schema for the form'),
        prompt: z.string().describe('High-level prompt/context for the form (clients may show it)'),
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
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Timeout in milliseconds (optional - no timeout if not specified)'),
        timestamp: z.date().describe('When the request was created'),
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
 * Command confirmation request schema
 */
export const CommandConfirmationRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.COMMAND_CONFIRMATION),
    metadata: CommandConfirmationMetadataSchema,
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
 * Directory access request schema
 */
export const DirectoryAccessRequestSchema = BaseApprovalRequestSchema.extend({
    type: z.literal(ApprovalType.DIRECTORY_ACCESS),
    metadata: DirectoryAccessMetadataSchema,
}).strict();

/**
 * Discriminated union for all approval requests
 */
export const ApprovalRequestSchema = z.discriminatedUnion('type', [
    ToolApprovalRequestSchema,
    CommandConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    DirectoryAccessRequestSchema,
]);

/**
 * Tool approval response data schema
 */
export const ToolApprovalResponseDataSchema = z
    .object({
        rememberChoice: z
            .boolean()
            .optional()
            .describe('Remember this tool for the session (approves ALL uses of this tool)'),
        rememberPattern: z
            .string()
            .optional()
            .describe(
                'Remember an approval pattern (e.g., "git *"). ' +
                    'Only applicable when the tool provides pattern-based approval support.'
            ),
        rememberDirectory: z
            .boolean()
            .optional()
            .describe(
                'Remember this directory for the session (allows future access without prompting again)'
            ),
    })
    .strict()
    .describe('Tool approval response data');

/**
 * Command confirmation response data schema
 */
export const CommandConfirmationResponseDataSchema = z
    .object({
        // Command confirmations don't have remember choice - they're per-command
        // Could add command pattern remembering in future (e.g., "remember git push *")
    })
    .strict()
    .describe('Command confirmation response data');

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
 * Directory access response data schema
 */
export const DirectoryAccessResponseDataSchema = z
    .object({
        rememberDirectory: z
            .boolean()
            .optional()
            .describe('Remember this directory for the session (allows all file access within it)'),
    })
    .strict()
    .describe('Directory access response data');

/**
 * Base approval response schema
 */
export const BaseApprovalResponseSchema = z
    .object({
        approvalId: z.string().uuid().describe('Must match request approvalId'),
        status: ApprovalStatusSchema.describe('Approval status'),
        sessionId: z.string().optional().describe('Session identifier'),
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
 * Command confirmation response schema
 */
export const CommandConfirmationResponseSchema = BaseApprovalResponseSchema.extend({
    data: CommandConfirmationResponseDataSchema.optional(),
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
 * Directory access response schema
 */
export const DirectoryAccessResponseSchema = BaseApprovalResponseSchema.extend({
    data: DirectoryAccessResponseDataSchema.optional(),
}).strict();

/**
 * Union of all approval responses
 */
export const ApprovalResponseSchema = z.union([
    ToolApprovalResponseSchema,
    CommandConfirmationResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
    DirectoryAccessResponseSchema,
]);

/**
 * Approval request details schema for creating requests
 */
export const ApprovalRequestDetailsSchema = z
    .object({
        type: ApprovalTypeSchema,
        sessionId: z.string().optional(),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Timeout in milliseconds (optional - no timeout if not specified)'),
        metadata: z.union([
            ToolApprovalMetadataSchema,
            CommandConfirmationMetadataSchema,
            ElicitationMetadataSchema,
            CustomApprovalMetadataSchema,
            DirectoryAccessMetadataSchema,
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
        } else if (data.type === ApprovalType.COMMAND_CONFIRMATION) {
            const result = CommandConfirmationMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'Metadata must match CommandConfirmationMetadataSchema for COMMAND_CONFIRMATION type',
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
        } else if (data.type === ApprovalType.DIRECTORY_ACCESS) {
            const result = DirectoryAccessMetadataSchema.safeParse(data.metadata);
            if (!result.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'Metadata must match DirectoryAccessMetadataSchema for DIRECTORY_ACCESS type',
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
