// Browser-safe surface for consumers like the Web UI.
// Re-export only types and utilities that do not pull in Node-only deps.

export type { Issue } from './errors/types.js';
export { toError } from './utils/error-conversion.js';
export type { TextPart as CoreTextPart, InternalMessage, FilePart } from './context/types.js';
export type { LLMRouter, LLMProvider } from './llm/registry.js';
export type { McpServerConfig } from './mcp/schemas.js';
