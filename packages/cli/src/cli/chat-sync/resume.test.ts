import { expect, it } from 'vitest';
import { resumeTranscript } from './resume.js';

it('resumes from the export cursor, follows sparse pages, and saves the server sync cursor', async () => {
    const requested: number[] = [];
    const saved: string[] = [];
    const result = await resumeTranscript(7, {
        sourceChatId: 'cloud-chat',
        read: async (from) => {
            requested.push(from);
            return {
                object: 'synced_chat_transcript',
                messages: [
                    {
                        index: from + 1,
                        role: 'assistant',
                        created_at: '2026-11-06T00:00:00Z',
                        parts: [{ type: 'text', text: `cloud ${from}` }],
                    },
                ],
                next_from_index: from === 7 ? 12 : null,
                sync_from_index: 20,
            };
        },
        append: async (message) => {
            saved.push(message.id ?? 'missing');
        },
    });
    expect(requested).toEqual([7, 12]);
    expect(saved).toEqual(['cloud:cloud-chat:8', 'cloud:cloud-chat:13']);
    expect(result).toEqual({ syncFromIndex: 20, appended: 2 });
});
