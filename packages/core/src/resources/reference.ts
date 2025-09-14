/**
 * Resource reference parsing and expansion
 */

export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';
export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';
