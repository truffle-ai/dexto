/**
 * Resource reference parsing and expansion
 */

export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';
// TODO: (355) Delete this file
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413184882
export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';
