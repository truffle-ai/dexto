import { afterEach, expect, it } from 'vitest';
import { setTuiRuntimeServices } from '../host/index.js';
import { runChatMove } from './chat-sync-commands.js';

afterEach(() => setTuiRuntimeServices({}));

it('requests visible history reload after a successful local return', async () => {
    setTuiRuntimeServices({ chatMove: async () => 'Local again' });
    expect(await runChatMove('local', [], 'chat')).toEqual({
        __reloadHistory: true,
        sessionId: 'chat',
        output: 'Local again',
    });
    expect(await runChatMove('cloud', [], 'chat')).toBe('Local again');
});

it('does not reload history when the return failed', async () => {
    setTuiRuntimeServices({
        chatMove: async () => {
            throw new Error('return failed');
        },
    });
    await expect(runChatMove('local', [], 'chat')).rejects.toThrow('return failed');
});
