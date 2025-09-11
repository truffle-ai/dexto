/**
 * Tools System for Dexto
 *
 * This module provides the unified tool management system that handles
 * MCP servers and internal tools.
 */

// Core types and interfaces
export * from './types.js';

// Confirmation types
export * from './confirmation/types.js';

// Internal tools provider and types
export * from './internal-tools/index.js';

// Schemas/types
export * from './schemas.js';

// Unified tool manager (main interface for LLM)
export { ToolManager, type InternalToolsOptions } from './tool-manager.js';
