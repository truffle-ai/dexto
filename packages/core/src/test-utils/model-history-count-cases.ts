import type { InternalMessage } from '../context/types.js';

/**
 * Stored histories for checking that a store's `countModelMessages` equals the length of its
 * `loadModelHistory` messages. A message is written as one of:
 *   `u`, `a`  a user or assistant message
 *   `t`       a tool result that core has pruned (`compactedAt`)
 *   `S`       a summary with no original message count (legacy)
 *   `S:n`     a summary preserving the messages after the first `n`
 *   `SS:n`    the same, marked as a session summary
 */
export const MODEL_HISTORY_COUNT_CASES: readonly { name: string; history: string }[] = [
    { name: 'empty', history: '' },
    { name: 'one message', history: 'u' },
    { name: 'plain', history: 'u a u a u a' },
    { name: 'plain with pruned rows', history: 'u a t t u a t u a' },
    { name: 'legacy summary', history: 'u a u a S u a' },
    { name: 'summary with preserved messages', history: 'u a u a u a S:2 u a' },
    { name: 'summary preserving everything', history: 'u a u a S:0 u' },
    { name: 'summary preserving nothing', history: 'u a u a S:4 u' },
    { name: 'original count past the summary', history: 'u a u a S:99 u' },
    { name: 'negative original count', history: 'u a u a S:-3 u' },
    { name: 'summary with messages after it', history: 'u a u a S:1 u a u a' },
    { name: 'summary as the last message', history: 'u a u a u S:3' },
    { name: 'two summaries', history: 'u a S:1 u a u a S:3 u' },
    { name: 'two summaries with pruned rows', history: 'u a t t S:1 u t a S:4 t u' },
    { name: 'session summary with preserved messages', history: 'u a u a u SS:2 u a' },
    { name: 'session summary with a clamped count', history: 'u a u a SS:50 u' },
];

export function buildModelHistoryCountMessages(history: string): InternalMessage[] {
    return history
        .split(' ')
        .filter((token) => token !== '')
        .map((token, index): InternalMessage => {
            const id = `message-${index}`;
            const timestamp = index + 1;
            if (token === 'u') {
                return { id, role: 'user', content: [{ type: 'text', text: token }], timestamp };
            }
            if (token === 'a') {
                return {
                    id,
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: token }],
                    timestamp,
                };
            }
            if (token === 't') {
                return {
                    id,
                    role: 'tool',
                    name: 'read',
                    toolCallId: `call-${index}`,
                    content: [{ type: 'text', text: 'old result' }],
                    compactedAt: 1,
                    timestamp,
                };
            }
            const [kind, count] = token.split(':');
            return {
                id,
                role: 'assistant',
                assistantOutput: { status: 'complete' },
                content: [{ type: 'text', text: 'summary' }],
                metadata: {
                    ...(kind === 'SS' ? { isSessionSummary: true } : { isSummary: true }),
                    ...(count === undefined ? {} : { originalMessageCount: Number(count) }),
                },
                timestamp,
            };
        });
}
