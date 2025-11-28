/**
 * Compression strategies for context management.
 *
 * @see /complete-context-management-plan.md
 */

// MiddleRemoval - simple synchronous strategy
export { MiddleRemovalStrategy } from './middle-removal.js';
export type { MiddleRemovalOptions } from './middle-removal.js';

// ReactiveOverflow - LLM-based async strategy
export { ReactiveOverflowStrategy, createSummaryPrompt } from './reactive-overflow.js';
export type { ReactiveOverflowOptions, SummaryGenerator } from './reactive-overflow.js';

// Tool Output Pruning - mark-don't-delete strategy
export {
    pruneOldToolOutputs,
    formatToolOutputContent,
    isCompacted,
    getCompactedPlaceholder,
} from './tool-output-pruning.js';
export type { ToolOutputPruningOptions, PruneResult } from './tool-output-pruning.js';
