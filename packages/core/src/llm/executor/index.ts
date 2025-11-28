/**
 * LLM Executor module - handles the execution loop for LLM interactions.
 *
 * Components:
 * - TurnExecutor: Main loop with stopWhen: stepCountIs(1)
 * - StreamProcessor: Event interception and persistence
 * - Types: New type definitions for the refactored architecture
 *
 * @see /complete-context-management-plan.md
 */

export type {
    // Compression
    CompressionTrigger,
    ICompressionStrategy,
    // Message Queue
    UserMessageContentPart,
    QueuedMessage,
    CoalescedMessage,
    // Tool Output
    ToolOutputConfig,
    TurnResult,
    // Tool Result Extensions
    ToolResultMetadata,
} from './types.js';

// Message Queue Service
export { MessageQueueService } from './message-queue.js';
export type { MessageQueueServiceOptions } from './message-queue.js';

// Compression Strategies
export {
    // MiddleRemoval strategy (sync)
    MiddleRemovalStrategy,
    // ReactiveOverflow strategy (async, LLM-based)
    ReactiveOverflowStrategy,
    createSummaryPrompt,
    // Tool output pruning utilities (for OLD outputs)
    pruneOldToolOutputs,
    formatToolOutputContent,
    isCompacted,
    getCompactedPlaceholder,
    // Tool output truncation utilities (for NEW outputs)
    truncateToolOutput,
    truncateToolResult,
    truncateByLines,
    DEFAULT_MAX_TOOL_OUTPUT_CHARS,
    DEFAULT_MAX_TOOL_OUTPUT_LINES,
    DEFAULT_TOOL_LIMITS,
} from './strategies/index.js';
export type {
    MiddleRemovalOptions,
    ReactiveOverflowOptions,
    SummaryGenerator,
    ToolOutputPruningOptions,
    PruneResult,
    TruncateResult,
} from './strategies/index.js';

// Turn Executor
export { TurnExecutor } from './turn-executor.js';
export type { StepUsage, TurnExecutorConfig, TurnExecutorDeps } from './turn-executor.js';

// Stream Processor
export { StreamProcessor } from './stream-processor.js';
export type { StreamProcessorConfig, StreamProcessorResult } from './stream-processor.js';
