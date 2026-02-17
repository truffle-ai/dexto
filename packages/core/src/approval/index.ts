// ============================================================================
// USER APPROVAL SYSTEM - Public API
// ============================================================================

// Types
export type {
    ApprovalHandler,
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
// ToolApprovalMetadata, ToolApprovalRequest, ToolApprovalResponse, ToolApprovalResponseData

export { ApprovalType, ApprovalStatus, DenialReason } from './types.js';

// Schemas
export {
    ApprovalTypeSchema,
    ApprovalStatusSchema,
    DenialReasonSchema,
    ToolApprovalMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    BaseApprovalRequestSchema,
    ToolApprovalRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    ApprovalRequestSchema,
    ToolApprovalResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolApprovalResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
    ApprovalResponseSchema,
    ApprovalRequestDetailsSchema,
} from './schemas.js';

export type {
    ValidatedApprovalRequest,
    ValidatedApprovalResponse,
    ValidatedToolApprovalRequest,
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
