/**
 * Tools System for Dexto
 *
 * This module provides the unified tool management system that handles
 * MCP servers and internal tools.
 */

// Core types and interfaces
export type {
    InternalTool,
    ToolExecutionContext,
    ToolSet,
    ToolResult,
    ToolCall,
    ToolProvider,
} from './types.js';

// Internal tools provider
export { InternalToolsProvider } from './internal-tools/provider.js';
export type { InternalToolsServices } from './internal-tools/registry.js';
export type { InternalToolsConfig } from './schemas.js';

// Unified tool manager (main interface for LLM)
export { ToolManager, type InternalToolsOptions } from './tool-manager.js';
