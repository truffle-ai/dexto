/**
 * Session Compaction Service
 *
 * Handles session-native compaction where compacting a session creates a new
 * continuation session with the summary as initial context. This provides
 * clean session isolation with linking for traceability.
 *
 * ## Architecture
 *
 * Session A (compacted) --continuedTo--> Session B (active)
 *       ^                                      |
 *       +--------continuedFrom-----------------+
 *
 * When compaction triggers:
 * 1. Generate summary of old messages via compaction strategy
 * 2. Create new session with summary as first message (isSessionSummary marker)
 * 3. Mark old session as compacted (continuedTo, compactedAt)
 * 4. Emit session:continued event
 * 5. Return new session for caller to switch to
 */

import type { ICompactionStrategy } from '../context/compaction/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { SessionManager } from './session-manager.js';
import type { ChatSession } from './chat-session.js';
import type { InternalMessage, ContentPart } from '../context/types.js';
import type { AgentEventBus } from '../events/index.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { estimateMessagesTokens } from '../context/utils.js';

/**
 * Result returned when compaction creates a new continuation session.
 */
export interface CompactionResult {
    /** The session that was compacted */
    previousSessionId: string;
    /** The new session created for continuation */
    newSessionId: string;
    /** The ChatSession instance for the new session */
    newSession: ChatSession;
    /** The summary message added to the new session */
    summary: InternalMessage;
    /** Estimated tokens in the summary */
    summaryTokens: number;
    /** Number of messages that were summarized */
    originalMessages: number;
}

/**
 * Options for performing compaction.
 */
export interface CompactOptions {
    /** Why the compaction was triggered */
    reason: 'overflow' | 'manual';
    /** Optional AgentEventBus to emit session:continued event */
    eventBus?: AgentEventBus;
}

/**
 * Service for performing session-native compaction.
 *
 * Instead of adding a summary message to the same session and filtering at read-time,
 * this service creates a new session with the summary as the first message.
 * This provides cleaner session isolation while maintaining traceability via linking.
 */
export class SessionCompactionService {
    private readonly logger: IDextoLogger;

    constructor(
        private readonly sessionManager: SessionManager,
        private readonly compactionStrategy: ICompactionStrategy,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    /**
     * Perform session-native compaction.
     *
     * This creates a new continuation session with the summary as initial context,
     * then marks the old session as compacted.
     *
     * @param currentSession The session to compact
     * @param options Compaction options
     * @returns CompactionResult with new session, or null if compaction not needed/possible
     */
    async compact(
        currentSession: ChatSession,
        options: CompactOptions
    ): Promise<CompactionResult | null> {
        const { reason, eventBus } = options;
        const currentSessionId = currentSession.id;

        this.logger.info(
            `SessionCompactionService: Starting compaction for session ${currentSessionId} (reason: ${reason})`
        );

        // Get history from the current session
        const history = await currentSession.getHistory();

        if (history.length <= 2) {
            this.logger.debug('SessionCompactionService: History too short for compaction');
            return null;
        }

        // Generate summary using the compaction strategy
        // The strategy returns a summary message but we'll transform it for session-native use
        const summaryMessages = await this.compactionStrategy.compact(history);

        if (summaryMessages.length === 0) {
            this.logger.debug('SessionCompactionService: Strategy returned no summary');
            return null;
        }

        // Get the summary content from the first (and typically only) summary message
        const strategySummary = summaryMessages[0];
        if (!strategySummary || !strategySummary.content) {
            return null;
        }

        const summaryText = this.extractTextContent(strategySummary.content);

        // Create the session summary message for the new session
        // This is marked as isSessionSummary (not isSummary) to distinguish from
        // the old read-time filtering approach
        const summaryMessage: InternalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: summaryText }],
            timestamp: Date.now(),
            metadata: {
                isSessionSummary: true, // New marker for session-native compaction
                continuedFrom: currentSessionId,
                summarizedAt: Date.now(),
                originalMessageCount: history.length,
                originalFirstTimestamp: history[0]?.timestamp,
                originalLastTimestamp: history[history.length - 1]?.timestamp,
            },
        };

        // Estimate tokens in the summary
        const summaryTokens = estimateMessagesTokens([summaryMessage]);

        // Create new continuation session
        const { sessionId: newSessionId, session: newSession } =
            await this.sessionManager.createContinuationSession(currentSessionId);

        // Add the summary as the first message in the new session
        // We need to access the history provider through the context manager
        const contextManager = newSession.getContextManager();
        await contextManager.addMessage(summaryMessage);

        // Mark the old session as compacted with link to new session
        await this.sessionManager.markSessionCompacted(currentSessionId, newSessionId);

        this.logger.info(
            `SessionCompactionService: Compaction complete. ` +
                `${currentSessionId} → ${newSessionId}, ` +
                `${history.length} messages → summary (~${summaryTokens} tokens)`
        );

        // Emit session:continued event if event bus provided
        if (eventBus) {
            eventBus.emit('session:continued', {
                previousSessionId: currentSessionId,
                newSessionId,
                summaryTokens,
                originalMessages: history.length,
                reason,
                sessionId: newSessionId, // For consistency with other streaming events
            });
        }

        return {
            previousSessionId: currentSessionId,
            newSessionId,
            newSession,
            summary: summaryMessage,
            summaryTokens,
            originalMessages: history.length,
        };
    }

    /**
     * Extract text content from message content.
     */
    private extractTextContent(content: string | ContentPart[]): string {
        if (typeof content === 'string') {
            return content;
        }
        return content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }
}
