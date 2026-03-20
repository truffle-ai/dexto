import type { InternalMessage } from '../types.js';
import type { CompactionSummaryBoundary, CompactionWindow } from './types.js';

function isCompactionSummary(message: InternalMessage | undefined): boolean {
    return message?.metadata?.isSummary === true || message?.metadata?.isSessionSummary === true;
}

function findLatestCompactionSummary(
    history: readonly InternalMessage[]
): CompactionSummaryBoundary | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message && isCompactionSummary(message)) {
            return {
                message,
                storedIndex: i,
            };
        }
    }

    return undefined;
}

function resolveLegacyPreservedMessages(
    history: readonly InternalMessage[],
    summaryIndex: number,
    summaryMessage: InternalMessage
): InternalMessage[] {
    const rawCount = summaryMessage.metadata?.originalMessageCount;
    const originalMessageCount =
        typeof rawCount === 'number' && rawCount >= 0 && rawCount <= summaryIndex
            ? rawCount
            : summaryIndex;

    return history.slice(originalMessageCount, summaryIndex);
}

function resolvePreservedMessages(
    history: readonly InternalMessage[],
    summary: CompactionSummaryBoundary
): InternalMessage[] {
    const preservedMessageIds = summary.message.metadata?.preservedMessageIds;
    if (
        Array.isArray(preservedMessageIds) &&
        preservedMessageIds.every((messageId) => typeof messageId === 'string')
    ) {
        const messagesBeforeSummary = history.slice(0, summary.storedIndex);
        const messagesById = new Map(
            messagesBeforeSummary.flatMap((message) =>
                message.id ? [[message.id, message] as const] : []
            )
        );

        return preservedMessageIds.flatMap((messageId) => {
            const message = messagesById.get(messageId);
            return message ? [message] : [];
        });
    }

    return resolveLegacyPreservedMessages(history, summary.storedIndex, summary.message);
}

export function buildCompactionWindow(history: readonly InternalMessage[]): CompactionWindow {
    const storedHistory = history.slice();
    const latestSummary = findLatestCompactionSummary(storedHistory);

    if (!latestSummary) {
        return {
            storedHistory,
            activeHistory: storedHistory.slice(),
            preservedHistory: [],
            freshHistory: storedHistory.slice(),
            workingHistory: storedHistory.slice(),
        };
    }

    const preservedMessages = resolvePreservedMessages(storedHistory, latestSummary);
    const messagesAfterSummary = storedHistory.slice(latestSummary.storedIndex + 1);
    const workingHistory = [...preservedMessages, ...messagesAfterSummary];

    return {
        storedHistory,
        activeHistory: [latestSummary.message, ...workingHistory],
        preservedHistory: preservedMessages,
        freshHistory: messagesAfterSummary,
        workingHistory,
        latestSummary,
    };
}
