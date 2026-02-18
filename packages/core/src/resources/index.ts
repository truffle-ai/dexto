/**
 * Resource management module exports
 * Organized into thematic sub-barrels for better tree-shaking and maintainability
 */

// Core resource types and manager
export type { ResourceSource, ResourceMetadata, ResourceProvider, ResourceSet } from './types.js';

export type {
    ResourcesConfig,
    ValidatedResourcesConfig,
    ValidatedResourceConfig,
    ValidatedFileSystemResourceConfig,
    ValidatedBlobResourceConfig,
} from './schemas.js';

export { ResourceManager } from './manager.js';
export { ResourceError } from './errors.js';
export { ResourceErrorCodes } from './error-codes.js';

// Internal resources provider and handlers
export type { InternalResourceHandler, InternalResourceServices } from './handlers/types.js';
export { AgentResourcesProvider } from './agent-resources-provider.js';
export {
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './handlers/factory.js';

// Resource reference parsing and expansion
/**
 * Resource References
 *
 * Resource references allow you to include resource content in messages using @ syntax:
 *
 * Syntax:
 * - Simple name: @filename.txt
 * - URI with brackets: @<file:///path/to/file.txt>
 * - Server-scoped: @servername:resource-identifier
 *
 * Important: @ symbols are ONLY treated as resource references if they:
 * 1. Are at the start of the message, OR
 * 2. Are preceded by whitespace (space, tab, newline)
 *
 * This means email addresses like "user@example.com" are automatically ignored
 * without requiring any escape sequences. No special handling needed!
 *
 * Examples:
 * - "@myfile.txt" → resource reference (at start)
 * - "Check @myfile.txt" → resource reference (after space)
 * - "user@example.com" → literal text (no leading space)
 * - "See @file1.txt and email user@example.com" → only @file1.txt is a reference
 */
export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';
export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';

// Schemas and validation
export { ResourceConfigSchema, ResourcesConfigSchema } from './schemas.js';
