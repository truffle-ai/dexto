/**
 * Tools System for Dexto
 *
 * This module provides the unified tool management system that handles
 * MCP servers and internal tools.
 */

// Core types and interfaces
export * from './types.js';

// Display types for tool result rendering
export * from './display-types.js';

// Internal tools provider and types
export * from './internal-tools/index.js';

// Custom tool registry and provider interface
export {
    customToolRegistry,
    type CustomToolProvider,
    type CustomToolRegistry,
    type ToolCreationContext,
} from './custom-tool-registry.js';

// Custom tool schema registry for early validation
export { customToolSchemaRegistry } from './custom-tool-schema-registry.js';

// Schemas/types
export * from './schemas.js';

// Tool errors and error codes
export { ToolError } from './errors.js';
export { ToolErrorCode } from './error-codes.js';

// Unified tool manager (main interface for LLM)
export { ToolManager, type ToolExecutionContextFactory } from './tool-manager.js';
