import { randomUUID } from 'crypto';
import type { LanguageModel } from 'ai';
import { estimateContextTokens } from '../context/utils.js';
import type { ContentPart, InternalMessage } from '../context/types.js';
import type { Logger } from '../logger/v2/types.js';
import type { AgentEventBus, SessionEventBus } from '../events/index.js';
import type { DynamicContributorContext } from '../systemPrompt/types.js';
import type { ToolSet } from '../tools/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorType } from '../errors/types.js';
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
    const originalMessageCount = resolveSummaryBoundary(
        summaryMessages,
        history.length,
        input.compactionStrategy.name
    );
    const continuationMessages = [
        ...summaryMessages.map(cloneCompactionMessage),
        ...history.slice(originalMessageCount).map(normalizeCompactionMessage),
    ];

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
            await input.contextManager.addMessage(cloneCompactionMessage(summary));
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
    const normalized = cloneCompactionMessage(message);
    if (!normalized.id) {
        normalized.id = randomUUID();
    }
    if (!normalized.timestamp) {
        normalized.timestamp = Date.now();
    }
    return normalized;
}

function cloneCompactionMessage(message: InternalMessage): InternalMessage {
    const base = {
        role: message.role,
        ...(message.id !== undefined && { id: message.id }),
        ...(message.timestamp !== undefined && { timestamp: message.timestamp }),
        ...(message.metadata !== undefined && { metadata: structuredClone(message.metadata) }),
    };

    switch (message.role) {
        case 'system':
            return {
                ...base,
                role: 'system',
                content: message.content.map(cloneContentPart),
            };
        case 'user':
            return {
                ...base,
                role: 'user',
                content: message.content.map(cloneContentPart),
            };
        case 'assistant':
            return {
                ...base,
                role: 'assistant',
                content: message.content?.map(cloneContentPart) ?? null,
                ...(message.reasoning !== undefined && { reasoning: message.reasoning }),
                ...(message.reasoningMetadata !== undefined && {
                    reasoningMetadata: structuredClone(message.reasoningMetadata),
                }),
                ...(message.tokenUsage !== undefined && {
                    tokenUsage: structuredClone(message.tokenUsage),
                }),
                ...(message.estimatedCost !== undefined && {
                    estimatedCost: message.estimatedCost,
                }),
                ...(message.pricingStatus !== undefined && {
                    pricingStatus: message.pricingStatus,
                }),
                ...(message.usageScopeId !== undefined && {
                    usageScopeId: message.usageScopeId,
                }),
                ...(message.model !== undefined && { model: message.model }),
                ...(message.provider !== undefined && { provider: message.provider }),
                ...(message.toolCalls !== undefined && {
                    toolCalls: message.toolCalls.map((toolCall) => ({
                        id: toolCall.id,
                        type: toolCall.type,
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments,
                        },
                        ...(toolCall.providerOptions !== undefined && {
                            providerOptions: structuredClone(toolCall.providerOptions),
                        }),
                    })),
                }),
            };
        case 'tool':
            return {
                ...base,
                role: 'tool',
                content: message.content.map(cloneContentPart),
                toolCallId: message.toolCallId,
                name: message.name,
                ...(message.presentationSnapshot !== undefined && {
                    presentationSnapshot: structuredClone(message.presentationSnapshot),
                }),
                ...(message.success !== undefined && { success: message.success }),
                ...(message.requireApproval !== undefined && {
                    requireApproval: message.requireApproval,
                }),
                ...(message.approvalStatus !== undefined && {
                    approvalStatus: message.approvalStatus,
                }),
                ...(message.compactedAt !== undefined && {
                    compactedAt: message.compactedAt,
                }),
                ...(message.displayData !== undefined && {
                    displayData: structuredClone(message.displayData),
                }),
            };
    }
}

function cloneContentPart(messagePart: ContentPart): ContentPart {
    switch (messagePart.type) {
        case 'text':
            return {
                type: 'text',
                text: messagePart.text,
            };
        case 'image':
            return {
                type: 'image',
                image: cloneBinaryPayload(messagePart.image),
                ...(messagePart.mimeType !== undefined && {
                    mimeType: messagePart.mimeType,
                }),
            };
        case 'file':
            return {
                type: 'file',
                data: cloneBinaryPayload(messagePart.data),
                mimeType: messagePart.mimeType,
                ...(messagePart.filename !== undefined && {
                    filename: messagePart.filename,
                }),
            };
        case 'ui-resource':
            return {
                type: 'ui-resource',
                uri: messagePart.uri,
                mimeType: messagePart.mimeType,
                ...(messagePart.content !== undefined && {
                    content: messagePart.content,
                }),
                ...(messagePart.blob !== undefined && {
                    blob: messagePart.blob,
                }),
                ...(messagePart.metadata !== undefined && {
                    metadata: structuredClone(messagePart.metadata),
                }),
            };
    }
}

function cloneBinaryPayload(
    value: string | Uint8Array | Buffer | ArrayBuffer | URL
): string | Uint8Array | Buffer | ArrayBuffer {
    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof URL) {
        return value.toString();
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }

    return value.slice(0);
}

function resolveSummaryBoundary(
    summaryMessages: readonly InternalMessage[],
    historyLength: number,
    strategyName: string
): number {
    if (summaryMessages.length !== 1) {
        throw new DextoRuntimeError(
            'invalid_compaction_output',
            'system',
            ErrorType.SYSTEM,
            `Compaction strategy '${strategyName}' must return exactly one summary message for session-level compaction`,
            {
                strategy: strategyName,
                summaryMessageCount: summaryMessages.length,
            }
        );
    }

    const [summaryMessage] = summaryMessages;
    if (
        summaryMessage?.metadata?.isSummary !== true &&
        summaryMessage?.metadata?.isSessionSummary !== true
    ) {
        throw new DextoRuntimeError(
            'invalid_compaction_output',
            'system',
            ErrorType.SYSTEM,
            `Compaction strategy '${strategyName}' must mark its summary message with metadata.isSummary or metadata.isSessionSummary`,
            {
                strategy: strategyName,
            }
        );
    }

    const rawOriginalMessageCount = summaryMessage.metadata?.originalMessageCount;
    if (
        typeof rawOriginalMessageCount !== 'number' ||
        !Number.isInteger(rawOriginalMessageCount) ||
        rawOriginalMessageCount < 0 ||
        rawOriginalMessageCount > historyLength
    ) {
        throw new DextoRuntimeError(
            'invalid_compaction_output',
            'system',
            ErrorType.SYSTEM,
            `Compaction strategy '${strategyName}' must provide a valid metadata.originalMessageCount within the current history bounds`,
            {
                strategy: strategyName,
                originalMessageCount: rawOriginalMessageCount,
                historyLength,
            }
        );
    }

    return rawOriginalMessageCount;
}

function toCompactionReason(trigger: SessionCompactionTrigger): 'overflow' | 'manual' {
    return trigger === 'overflow' ? 'overflow' : 'manual';
}
