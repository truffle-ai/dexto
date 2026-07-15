/**
 * Tools System for Dexto
 *
 * This module provides the unified tool management system that handles
 * MCP servers and internal tools.
 */

// Core types and interfaces
export * from './types.js';

// Tool definition helper (schema-driven typing)
export { defineTool } from './define-tool.js';
export {
    SessionToolPreferencesSchema,
    SessionToolPreferencesStore,
} from './session-tool-preferences-store.js';
export type { SessionToolPreferences } from './session-tool-preferences-store.js';

// Display types for tool result rendering
export * from './display-types.js';
export * from './activity.js';
export {
    isToolPresentationSnapshotV1,
    ToolPresentationSnapshotV1Schema,
} from './presentation-schema.js';
export type { ToolPresentationSnapshotV1 } from './presentation-schema.js';

// Schemas/types
export * from './schemas.js';

// Presentation helpers
export * from './presentation.js';
export type { ToolCallMetadata, ToolCallMetaWrapper } from './tool-call-metadata.js';

// Tool errors and error codes
export { ToolError } from './errors.js';
export { ToolErrorCode } from './error-codes.js';

// Unified tool manager (main interface for LLM)
export { ToolManager, type ToolExecutionContextFactory } from './tool-manager.js';
export type {
    ExecutableToolCall,
    RecordedToolApproval,
    ToolApprovalDecisionApplication,
    ToolApprovalRecordIdentity,
    ApprovalRequiredPreparedToolCall,
    PreparedToolCall,
    PrepareToolCallInput,
} from './tool-manager.js';
