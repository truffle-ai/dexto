import { randomUUID } from 'crypto';
import type { LanguageModel } from 'ai';
import { estimateContextTokens } from '../context/utils.js';
import type { ContentPart, InternalMessage } from '../context/types.js';
import type { Logger } from '../logger/v2/types.js';
import type { AgentEventBus, SessionEventBus } from '../events/index.js';
import type { DynamicContributorContext } from '../systemPrompt/types.js';
import type { ToolSet } from '../tools/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { buildCompactionWindow } from '../context/compaction/window.js';
import type {
    SessionCompactionMode,
    SessionCompactionRecord,
    SessionCompactionTrigger,
} from './compaction.js';
import { SessionCompactionError } from './errors.js';

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
    deleteSessionCompaction(compactionId: string): Promise<void>;
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
    const compactionWindow = buildCompactionWindow(history);

    const beforeEstimate = await input.contextManager.getContextTokenEstimate(
        input.contributorContext,
        input.tools
    );
    const originalTokens = input.originalTokensOverride ?? beforeEstimate.estimated;
    const originalMessages = beforeEstimate.stats.filteredMessageCount;

    input.eventSink.emitCompacting({
        estimatedTokens: originalTokens,
    });

    const compactionResult = await input.compactionStrategy.compact(compactionWindow, {
        sessionId: input.sessionId,
        model: input.languageModel,
        logger: input.logger,
    });

    if (!compactionResult || compactionResult.summaryMessages.length === 0) {
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

    const preserveFromWorkingIndex = resolveWorkingBoundary(
        compactionResult,
        compactionWindow.workingHistory.length,
        input.compactionStrategy.name
    );
    const preservedSourceMessages = compactionWindow.workingHistory.slice(preserveFromWorkingIndex);
    const preservedWorkingMessages = preservedSourceMessages.map(normalizeCompactionMessage);
    const preservedMessageIds = resolvePreservedMessageIds(
        input.mode === 'continue-in-place' ? preservedSourceMessages : preservedWorkingMessages,
        input.compactionStrategy.name
    );
    const summaryMessages = compactionResult.summaryMessages.map((summaryMessage) =>
        normalizeSummaryMessage(
            summaryMessage,
            preservedMessageIds,
            !!compactionWindow.latestSummary
        )
    );
    const continuationMessages = [
        ...summaryMessages.map(cloneCompactionMessage),
        ...preservedWorkingMessages.map(cloneCompactionMessage),
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
        try {
            for (const summary of summaryMessages) {
                await input.contextManager.addMessage(cloneCompactionMessage(summary));
            }
        } catch (error) {
            try {
                await input.persistence.deleteSessionCompaction(compaction.id);
                input.logger.warn(
                    `Rolled back compaction artifact ${compaction.id} after in-place compaction apply failure`
                );
            } catch (rollbackError) {
                input.logger.error(
                    `Failed to roll back compaction artifact ${compaction.id} after in-place compaction apply failure: ${
                        rollbackError instanceof Error
                            ? rollbackError.message
                            : String(rollbackError)
                    }`
                );
            }
            throw error;
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

function normalizeSummaryMessage(
    message: InternalMessage,
    preservedMessageIds: readonly string[],
    isRecompaction: boolean
): InternalMessage {
    const normalized = normalizeCompactionMessage(message);
    normalized.metadata = {
        ...(normalized.metadata ?? {}),
        isSummary: normalized.metadata?.isSummary ?? true,
        preservedMessageIds: [...preservedMessageIds],
        ...(isRecompaction && normalized.metadata?.isRecompaction !== true
            ? { isRecompaction: true }
            : {}),
    };
    if (normalized.metadata) {
        delete normalized.metadata.originalMessageCount;
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

function resolveWorkingBoundary(
    result: {
        summaryMessages: readonly InternalMessage[];
        preserveFromWorkingIndex: number;
    },
    workingHistoryLength: number,
    strategyName: string
): number {
    if (result.summaryMessages.length !== 1) {
        throw SessionCompactionError.invalidSummaryCount(
            strategyName,
            result.summaryMessages.length
        );
    }

    const preserveFromWorkingIndex = result.preserveFromWorkingIndex;
    if (
        typeof preserveFromWorkingIndex !== 'number' ||
        !Number.isInteger(preserveFromWorkingIndex) ||
        preserveFromWorkingIndex < 0 ||
        preserveFromWorkingIndex > workingHistoryLength
    ) {
        throw SessionCompactionError.invalidPreserveFromWorkingIndex(
            strategyName,
            preserveFromWorkingIndex,
            workingHistoryLength
        );
    }

    return preserveFromWorkingIndex;
}

function resolvePreservedMessageIds(
    preservedMessages: readonly InternalMessage[],
    strategyName: string
): string[] {
    const preservedMessageIds: string[] = [];
    for (const message of preservedMessages) {
        if (!message.id) {
            throw SessionCompactionError.preservedMessageMissingId(strategyName);
        }
        preservedMessageIds.push(message.id);
    }

    return preservedMessageIds;
}

function toCompactionReason(trigger: SessionCompactionTrigger): 'overflow' | 'manual' {
    return trigger === 'overflow' ? 'overflow' : 'manual';
}
