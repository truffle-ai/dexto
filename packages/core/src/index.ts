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

// Tools
export * from './tools/index.js';

// Context
export * from './context/index.js';

// Utils
export * from './utils/index.js';

//telemetry
export * from './telemetry/index.js';
