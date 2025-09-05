// Browser-safe root exports for @dexto/core
// Export only pure, environment-safe utilities and types.

// Safe runtime utilities
export { toError } from './utils/error-conversion.js';
export { zodToIssues } from './utils/result.js';

// Error types (types only on consumer side in TS; runtime is safe here)
export type { Issue, Severity, DextoErrorCode } from './errors/types.js';
export { ErrorScope, ErrorType } from './errors/types.js';

// Context/message types
export type { InternalMessage, TextPart, ImagePart, FilePart } from './context/types.js';

// LLM provider/router enums and constants (pure data)
export type { LLMProvider, LLMRouter } from './llm/types.js';
export { LLM_PROVIDERS, LLM_ROUTERS, SUPPORTED_FILE_TYPES } from './llm/types.js';
