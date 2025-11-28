/**
 * Tool Output Pruning - Mark-don't-delete strategy for old tool outputs.
 *
 * Instead of deleting old tool results, we mark them with `compactedAt` timestamp.
 * When formatting messages for the LLM, marked outputs are replaced with a placeholder.
 * This preserves the conversation structure while reducing token usage.
 *
 * @see /complete-context-management-plan.md
 */

import type { InternalMessage } from '../../../context/types.js';
import type { ITokenizer } from '../../tokenizer/types.js';
import type { IDextoLogger } from '../../../logger/v2/types.js';
import { DextoLogComponent } from '../../../logger/v2/types.js';
import { eventBus } from '../../../events/index.js';

/**
 * Configuration for tool output pruning.
 */
export interface ToolOutputPruningOptions {
    /**
     * Keep this many tokens worth of tool outputs (counting from most recent).
     * Default: 40000 (40K tokens)
     */
    pruneProtectTokens?: number;

    /**
     * Only prune if we can save at least this many tokens.
     * Prevents unnecessary churn for small savings.
     * Default: 20000 (20K tokens)
     */
    pruneMinimumSavings?: number;
}

const DEFAULT_PRUNE_PROTECT = 40_000;
const DEFAULT_PRUNE_MINIMUM = 20_000;
const PLACEHOLDER_TEXT = '[Old tool result content cleared]';

/**
 * Estimate token count for a string (rough approximation).
 * Uses ~4 characters per token as a heuristic.
 */
function estimateTokens(content: string | null): number {
    if (!content) return 0;
    return Math.ceil(content.length / 4);
}

/**
 * Get the text content from an InternalMessage for token estimation.
 */
function getMessageTextContent(message: InternalMessage): string {
    if (typeof message.content === 'string') {
        return message.content;
    }
    if (Array.isArray(message.content)) {
        return message.content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }
    return '';
}

/**
 * Result of pruning operation.
 */
export interface PruneResult {
    /** Whether any pruning was performed */
    pruned: boolean;
    /** Number of tool messages that were marked */
    prunedCount: number;
    /** Estimated tokens saved */
    savedTokens: number;
    /** IDs of messages that were marked */
    prunedMessageIds: string[];
}

/**
 * Prune old tool outputs by marking them with `compactedAt`.
 *
 * This function iterates through history from newest to oldest,
 * keeping track of tool output tokens. Once we exceed the protect threshold,
 * older tool outputs are marked for pruning.
 *
 * Important: This mutates the messages in place by setting `compactedAt`.
 * The caller should persist these changes to the history provider.
 *
 * @param history Message history (will be mutated)
 * @param tokenizer Tokenizer for accurate token counting
 * @param sessionId Session ID for event emission
 * @param logger Logger instance
 * @param options Pruning configuration
 * @returns Result of pruning operation
 */
export function pruneOldToolOutputs(
    history: InternalMessage[],
    tokenizer: ITokenizer,
    sessionId: string,
    logger: IDextoLogger,
    options: ToolOutputPruningOptions = {}
): PruneResult {
    const log = logger.createChild(DextoLogComponent.CONTEXT);
    const pruneProtect = options.pruneProtectTokens ?? DEFAULT_PRUNE_PROTECT;
    const pruneMinimum = options.pruneMinimumSavings ?? DEFAULT_PRUNE_MINIMUM;

    let totalToolTokens = 0;
    let prunedTokens = 0;
    const toPrune: InternalMessage[] = [];

    // Iterate backwards through history (newest first)
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (!msg) continue;

        // Stop at summary messages (don't prune beyond summaries)
        if (msg.role === 'assistant') {
            // Check if this is a summary message (has compression marker)
            const content = getMessageTextContent(msg);
            if (content.includes('[Earlier conversation context was compressed')) {
                log.debug('PruneToolOutputs: Stopping at summary marker');
                break;
            }
        }

        // Only process tool messages
        if (msg.role !== 'tool') continue;

        // Skip already compacted messages
        if (msg.compactedAt) {
            log.debug(`PruneToolOutputs: Skipping already compacted message ${msg.id}`);
            continue;
        }

        // Count tokens for this tool output
        const content = getMessageTextContent(msg);
        const tokens = tokenizer.countTokens(content);
        totalToolTokens += tokens;

        // If we're over the protect threshold, mark for pruning
        if (totalToolTokens > pruneProtect) {
            prunedTokens += tokens;
            toPrune.push(msg);
        }
    }

    // Only prune if we have significant savings
    if (prunedTokens < pruneMinimum) {
        log.debug(
            `PruneToolOutputs: Skipping - potential savings (${prunedTokens}) below minimum (${pruneMinimum})`
        );
        return {
            pruned: false,
            prunedCount: 0,
            savedTokens: 0,
            prunedMessageIds: [],
        };
    }

    // Mark messages for pruning
    const now = Date.now();
    const prunedIds: string[] = [];

    for (const msg of toPrune) {
        msg.compactedAt = now;
        if (msg.id) {
            prunedIds.push(msg.id);
        }
    }

    log.info(
        `PruneToolOutputs: Marked ${toPrune.length} tool outputs, saving ~${prunedTokens} tokens`
    );

    // Emit event
    eventBus.emit('context:pruned', {
        prunedCount: toPrune.length,
        savedTokens: prunedTokens,
        sessionId,
    });

    return {
        pruned: true,
        prunedCount: toPrune.length,
        savedTokens: prunedTokens,
        prunedMessageIds: prunedIds,
    };
}

/**
 * Format a tool message content, respecting `compactedAt` marker.
 *
 * If the message has been compacted, returns the placeholder text.
 * Otherwise returns the original content.
 *
 * This should be called when formatting messages for the LLM.
 *
 * @param message Tool message to format
 * @returns Content string (placeholder if compacted)
 */
export function formatToolOutputContent(message: InternalMessage): string {
    if (message.compactedAt) {
        return PLACEHOLDER_TEXT;
    }
    return getMessageTextContent(message);
}

/**
 * Check if a message has been compacted.
 */
export function isCompacted(message: InternalMessage): boolean {
    return message.compactedAt !== undefined;
}

/**
 * Get the placeholder text used for compacted outputs.
 */
export function getCompactedPlaceholder(): string {
    return PLACEHOLDER_TEXT;
}
