import { describe, expect, it, vi } from 'vitest';
import { sendTranscript } from './import-client.js';
import type { CommandContext } from '../command.js';

vi.mock('./workspace.js', () => ({ queryWorkspaceTool: vi.fn() }));

describe('import transport', () => {
    it('refuses native parts until a verified server contract is available', async () => {
        await expect(
            sendTranscript({} as CommandContext, {
                kind: 'native',
                input: {
                    source: 'codex',
                    sourceSessionId: 'session',
                    title: 'Test',
                    messages: [
                        {
                            role: 'assistant',
                            createdAt: '2026-01-01T00:00:00Z',
                            parts: [{ type: 'thinking', text: 'test' }],
                        },
                    ],
                },
            })
        ).rejects.toThrow('Native transcript import is not available yet');
    });
});
