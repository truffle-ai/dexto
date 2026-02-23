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

// Display types for tool result rendering
export * from './display-types.js';

// Schemas/types
export * from './schemas.js';

// Presentation helpers
export * from './presentation.js';

// Tool errors and error codes
export { ToolError } from './errors.js';
export { ToolErrorCode } from './error-codes.js';

// Unified tool manager (main interface for LLM)
export { ToolManager, type ToolExecutionContextFactory } from './tool-manager.js';
