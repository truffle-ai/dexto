import type { V1Response } from '@dexto/cloud-client';
import type { ContentPart, InternalMessage } from '@dexto/core';

type Transcript = V1Response<'/v1/synced_chats/{chat_id}/messages', 'get'>;

/** Stable message ids make replay after an interrupted return idempotent in the session store. */
export async function resumeTranscript(
    fromIndex: number,
    deps: {
        readonly read: (from: number) => Promise<Transcript>;
        readonly append: (message: InternalMessage) => Promise<void>;
    }
): Promise<{ syncFromIndex: number; appended: number }> {
    let from = fromIndex;
    let appended = 0;
    for (;;) {
        const page = await deps.read(from);
        for (const message of page.messages) {
            if (message.index < from) throw new Error('The cloud transcript moved backwards.');
            const text = message.parts
                .map((part) => {
                    switch (part.type) {
                        case 'text':
                            return part.text;
                        case 'tool':
                            return `[Cloud tool: ${part.name}]\n${part.input}\n${part.output ?? ''}`;
                        case 'attachment':
                            return `[Cloud attachment: ${part.name}, ${part.mime_type}, ${part.size_bytes} bytes]`;
                    }
                })
                .join('\n');
            const content: ContentPart[] = [{ type: 'text', text }];
            const base = {
                id: `cloud:${message.index}`,
                content,
                timestamp: Date.parse(message.created_at),
            };
            await deps.append(
                message.role === 'assistant'
                    ? { ...base, role: 'assistant', assistantOutput: { status: 'complete' } }
                    : { ...base, role: 'user' }
            );
            appended += 1;
        }
        if (page.next_from_index === null) return { syncFromIndex: page.sync_from_index, appended };
        if (page.next_from_index <= from)
            throw new Error('The cloud transcript cursor did not advance.');
        from = page.next_from_index;
    }
}
