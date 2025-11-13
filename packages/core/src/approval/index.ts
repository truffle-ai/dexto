// ============================================================================
// USER APPROVAL SYSTEM - Public API
// ============================================================================

// Types
export type {
    ApprovalProvider,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ElicitationMetadata,
    ElicitationRequest,
    ElicitationResponse,
    ElicitationResponseData,
    CustomApprovalMetadata,
    CustomApprovalRequest,
    CustomApprovalResponse,
    CustomApprovalResponseData,
    BaseApprovalRequest,
    BaseApprovalResponse,
} from './types.js';

// Internal types - not exported to avoid naming conflicts with tools module
// ToolConfirmationMetadata, ToolConfirmationRequest, ToolConfirmationResponse, ToolConfirmationResponseData

export { ApprovalType, ApprovalStatus, DenialReason } from './types.js';

// Schemas
export {
    ApprovalTypeSchema,
    ApprovalStatusSchema,
    DenialReasonSchema,
    ToolConfirmationMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    BaseApprovalRequestSchema,
    ToolConfirmationRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    ApprovalRequestSchema,
    ToolConfirmationResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolConfirmationResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
    ApprovalResponseSchema,
    ApprovalRequestDetailsSchema,
} from './schemas.js';

export type {
    ValidatedApprovalRequest,
    ValidatedApprovalResponse,
    ValidatedToolConfirmationRequest,
    ValidatedElicitationRequest,
    ValidatedCustomApprovalRequest,
} from './schemas.js';

// Error codes and errors
export { ApprovalErrorCode } from './error-codes.js';
export { ApprovalError } from './errors.js';
export type {
    ApprovalValidationContext,
    ApprovalTimeoutContext,
    ApprovalCancellationContext,
    ElicitationValidationContext,
} from './errors.js';

// Manager
export { ApprovalManager } from './manager.js';
export type { ApprovalManagerConfig } from './manager.js';

// Providers
export { EventBasedApprovalProvider } from './providers/event-based-approval-provider.js';
export { NoOpApprovalProvider } from './providers/noop-approval-provider.js';
