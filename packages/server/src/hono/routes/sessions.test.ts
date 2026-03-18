import { describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { createSessionsRouter } from './sessions.js';

function createAgent() {
    const clearContext = vi.fn(async () => {});
    return {
        agent: {
            clearContext,
        } as unknown as DextoAgent,
        clearContext,
    };
}

describe('createSessionsRouter', () => {
    it('clears session context without resetting the session', async () => {
        const { agent, clearContext } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/clear-context', {
            method: 'POST',
        });

        expect(response.status).toBe(200);
        expect(clearContext).toHaveBeenCalledWith('session-1');
        await expect(response.json()).resolves.toEqual({
            status: 'context cleared',
            sessionId: 'session-1',
        });
    });
});
