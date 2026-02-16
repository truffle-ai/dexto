/**
 * @dexto/core - Main entry point
 *
 * This package is designed for server-side use (Node.js).
 * For browser/client usage, use server components/actions or the API.
 *
 * The package.json conditional exports handle environment routing:
 * - Browser: Routes to index.browser.ts (minimal safe exports)
 * - Node: Routes to this file (full exports)
 *
 * TODO: Break down into subpath exports for better tree-shaking
 * Consider adding exports like:
 * - @dexto/core/telemetry - Telemetry utilities
 * - @dexto/core/llm - LLM services and factories
 * - @dexto/core/session - Session management (currently internal)
 * - @dexto/core/tools - Tool system
 * This would allow:
 * 1. Better tree-shaking (only import what you need)
 * 2. Cleaner public API boundaries
 * 3. Reduced bundle sizes for packages that only need specific functionality
 * 4. Avoid pulling in OpenTelemetry decorators for packages that don't need instrumentation
 */

// Core Agent
export * from './agent/index.js';

// Configuration
// Config loading has been moved to @dexto/agent-management
// Import from '@dexto/agent-management' instead:
// - loadAgentConfig
// - ConfigError
// - ConfigErrorCode

// Errors
export * from './errors/index.js';

// Events
export * from './events/index.js';

// LLM
export * from './llm/index.js';

// Search
export * from './search/index.js';

// Logger
export * from './logger/index.js';

// MCP
export * from './mcp/index.js';

// Session
export * from './session/index.js';

// Storage
export * from './storage/index.js';

// System Prompt
export * from './systemPrompt/index.js';

// Tools
export * from './tools/index.js';

// Context
export * from './context/index.js';
export { getFileMediaKind, getResourceKind } from './context/index.js';

// Prompts
export * from './prompts/index.js';

// Utils
export * from './utils/index.js';

// Resources
export * from './resources/index.js';

// Approval (User Approval System)
export * from './approval/index.js';

// Memory
export * from './memory/index.js';

// Plugins
export * from './plugins/index.js';

// Workspace
export * from './workspace/index.js';

// Telemetry
export * from './telemetry/index.js';

// Note: Blob types, schemas, and errors are exported from './storage/index.js'
