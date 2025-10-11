/**
 * @dexto/core - Main entry point
 *
 * This package is designed for server-side use (Node.js).
 * For browser/client usage, use server components/actions or the API.
 *
 * The package.json conditional exports handle environment routing:
 * - Browser: Routes to index.browser.ts (minimal safe exports)
 * - Node: Routes to this file (full exports)
 */

// Core Orchestrator
export { Dexto, getDexto } from './Dexto.js';

// Core Agent
export * from './agent/index.js';

// Configuration
export * from './config/index.js';

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

// Preferences
export * from './preferences/index.js';

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

// Prompts
export * from './prompts/index.js';

// Utils
export * from './utils/index.js';

// Resources
export * from './resources/index.js';

// Approval (User Approval System)
export * from './approval/index.js';

// Note: Blob types, schemas, and errors are exported from './storage/index.js'
