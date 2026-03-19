import { randomUUID } from 'crypto';
import type { LanguageModel } from 'ai';
import { estimateContextTokens, filterCompacted } from '../context/utils.js';
import type { InternalMessage } from '../context/types.js';
import type { Logger } from '../logger/v2/types.js';
import type { AgentEventBus, SessionEventBus } from '../events/index.js';
import type { DynamicContributorContext } from '../systemPrompt/types.js';
import type { ToolSet } from '../tools/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import type {
    SessionCompactionMode,
    SessionCompactionRecord,
    SessionCompactionTrigger,
} from './compaction.js';

interface SessionCompactionContextManager {
    getHistory(): Promise<readonly InternalMessage[]>;
    addMessage(message: InternalMessage): Promise<void>;
    resetActualTokenTracking(): void;
    getSystemPrompt(contributorContext: DynamicContributorContext): Promise<string>;
    getContextTokenEstimate(
        contributorContext: DynamicContributorContext,
        tools: ToolSet
    ): Promise<{
        estimated: number;
        stats: {
            filteredMessageCount: number;
        };
    }>;
}

export interface SessionCompactionPersistence {
    createSeededChildSession(
        parentSessionId: string,
        options: {
            initialMessages: readonly InternalMessage[];
            title?: string;
        }
    ): Promise<{
        id: string;
    }>;
    deleteSession(sessionId: string): Promise<void>;
    saveSessionCompaction(compaction: SessionCompactionRecord): Promise<void>;
}

export interface SessionCompactionEventSink {
    emitCompacting(payload: { estimatedTokens: number }): void;
    emitCompacted(payload: {
        originalTokens: number;
        compactedTokens: number;
        originalMessages: number;
        compactedMessages: number;
        strategy: string;
        reason: 'overflow' | 'manual';
        compactionId?: string;
        mode?: SessionCompactionMode;
        targetSessionId?: string;
    }): void;
}

export interface RunSessionCompactionInput {
    sessionId: string;
    mode: SessionCompactionMode;
    trigger: SessionCompactionTrigger;
    childTitle?: string;
    languageModel: LanguageModel;
    logger: Logger;
    contextManager: SessionCompactionContextManager;
    compactionStrategy: CompactionStrategy;
    contributorContext: DynamicContributorContext;
    tools: ToolSet;
    persistence: SessionCompactionPersistence;
    eventSink: SessionCompactionEventSink;
    originalTokensOverride?: number;
}

export function createAgentSessionCompactionEventSink(
    eventBus: AgentEventBus,
    sessionId: string
): SessionCompactionEventSink {
    return {
        emitCompacting: (payload) => {
            eventBus.emit('context:compacting', {
                ...payload,
                sessionId,
            });
        },
        emitCompacted: (payload) => {
            eventBus.emit('context:compacted', {
                ...payload,
                sessionId,
            });
        },
    };
}

export function createSessionCompactionEventSink(
    eventBus: SessionEventBus
): SessionCompactionEventSink {
    return {
        emitCompacting: (payload) => {
            eventBus.emit('context:compacting', payload);
        },
        emitCompacted: (payload) => {
            eventBus.emit('context:compacted', payload);
        },
    };
}

export async function runSessionCompaction(
    input: RunSessionCompactionInput
): Promise<SessionCompactionRecord | null> {
    const history = await input.contextManager.getHistory();
    if (history.length < 4) {
        input.logger.debug(`Compaction skipped for session ${input.sessionId} - history too short`);
        return null;
    }

    const beforeEstimate = await input.contextManager.getContextTokenEstimate(
        input.contributorContext,
        input.tools
    );
    const originalTokens = input.originalTokensOverride ?? beforeEstimate.estimated;
    const originalMessages = beforeEstimate.stats.filteredMessageCount;

    input.eventSink.emitCompacting({
        estimatedTokens: originalTokens,
    });

    const rawSummaryMessages = await input.compactionStrategy.compact(history, {
        sessionId: input.sessionId,
        model: input.languageModel,
        logger: input.logger,
    });

    if (rawSummaryMessages.length === 0) {
        input.logger.debug(
            `Compaction skipped for session ${input.sessionId} - nothing to compact`
        );
        input.eventSink.emitCompacted({
            originalTokens,
            compactedTokens: originalTokens,
            originalMessages,
            compactedMessages: originalMessages,
            strategy: input.compactionStrategy.name,
            reason: toCompactionReason(input.trigger),
        });
        return null;
    }

    const summaryMessages = rawSummaryMessages.map(normalizeCompactionMessage);
    const continuationMessages = filterCompacted([
        ...structuredClone(history),
        ...structuredClone(summaryMessages),
    ]).map(normalizeCompactionMessage);

    const systemPrompt = await input.contextManager.getSystemPrompt(input.contributorContext);
    const compactedTokens = estimateContextTokens(
        systemPrompt,
        continuationMessages,
        input.tools
    ).total;
    const compactedMessages = continuationMessages.length;

    const baseCompaction = {
        id: randomUUID(),
        sourceSessionId: input.sessionId,
        createdAt: Date.now(),
        strategy: input.compactionStrategy.name,
        mode: input.mode,
        trigger: input.trigger,
        originalTokens,
        compactedTokens,
        originalMessages,
        compactedMessages,
        summaryMessages,
        continuationMessages,
    } satisfies Omit<SessionCompactionRecord, 'targetSessionId'>;

    let compaction: SessionCompactionRecord;
    if (input.mode === 'continue-in-child') {
        const childSession = await input.persistence.createSeededChildSession(input.sessionId, {
            initialMessages: continuationMessages,
            ...(input.childTitle !== undefined && { title: input.childTitle }),
        });
        compaction = {
            ...baseCompaction,
            targetSessionId: childSession.id,
        };
        try {
            await input.persistence.saveSessionCompaction(compaction);
        } catch (error) {
            try {
                await input.persistence.deleteSession(childSession.id);
                input.logger.warn(
                    `Rolled back child session ${childSession.id} after compaction persistence failure`
                );
            } catch (rollbackError) {
                input.logger.error(
                    `Failed to roll back child session ${childSession.id} after compaction persistence failure: ${
                        rollbackError instanceof Error
                            ? rollbackError.message
                            : String(rollbackError)
                    }`
                );
            }
            throw error;
        }
    } else {
        compaction = baseCompaction;
        await input.persistence.saveSessionCompaction(compaction);
    }

    if (input.mode === 'continue-in-place') {
        for (const summary of summaryMessages) {
            await input.contextManager.addMessage(structuredClone(summary));
        }
        // The formula (lastInput + lastOutput + newEstimate) is no longer valid after compaction.
        input.contextManager.resetActualTokenTracking();
    }

    input.eventSink.emitCompacted({
        originalTokens,
        compactedTokens,
        originalMessages,
        compactedMessages,
        strategy: input.compactionStrategy.name,
        reason: toCompactionReason(input.trigger),
        compactionId: compaction.id,
        mode: input.mode,
        ...(compaction.targetSessionId !== undefined && {
            targetSessionId: compaction.targetSessionId,
        }),
    });

    input.logger.info(
        `Compaction complete for session ${input.sessionId}: ` +
            `${originalMessages} messages → ${compactedMessages} messages (~${compactedTokens} tokens) [mode=${input.mode}]`
    );

    return compaction;
}

function normalizeCompactionMessage(message: InternalMessage): InternalMessage {
    const normalized = structuredClone(message);
    if (!normalized.id) {
        normalized.id = randomUUID();
    }
    if (!normalized.timestamp) {
        normalized.timestamp = Date.now();
    }
    return normalized;
}

function toCompactionReason(trigger: SessionCompactionTrigger): 'overflow' | 'manual' {
    return trigger === 'overflow' ? 'overflow' : 'manual';
}
