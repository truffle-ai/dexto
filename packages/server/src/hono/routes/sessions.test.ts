import { describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { createSessionsRouter } from './sessions.js';

function createAgent() {
    const clearContext = vi.fn(async () => {});
    const getSessionSystemPromptContributors = vi.fn(async () => [
        {
            id: 'peer-origin',
            priority: 0,
            content: 'Reply to the originating thread.',
        },
    ]);
    const upsertSessionSystemPromptContributor = vi.fn(async () => ({
        replaced: false,
    }));
    const removeSessionSystemPromptContributor = vi.fn(async () => true);
    return {
        agent: {
            clearContext,
            getSessionSystemPromptContributors,
            upsertSessionSystemPromptContributor,
            removeSessionSystemPromptContributor,
        } as unknown as DextoAgent,
        clearContext,
        getSessionSystemPromptContributors,
        upsertSessionSystemPromptContributor,
        removeSessionSystemPromptContributor,
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

    it('lists session system prompt contributors', async () => {
        const { agent, getSessionSystemPromptContributors } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors');

        expect(response.status).toBe(200);
        expect(getSessionSystemPromptContributors).toHaveBeenCalledWith('session-1');
        await expect(response.json()).resolves.toEqual({
            contributors: [
                {
                    id: 'peer-origin',
                    priority: 0,
                },
            ],
        });
    });

    it('upserts session system prompt contributors', async () => {
        const { agent, upsertSessionSystemPromptContributor } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 'peer origin',
                priority: 5,
                content: 'Return the answer to the origin session.',
            }),
        });

        expect(response.status).toBe(200);
        expect(upsertSessionSystemPromptContributor).toHaveBeenCalledWith('session-1', {
            id: 'peer-origin',
            priority: 5,
            content: 'Return the answer to the origin session.',
        });
        await expect(response.json()).resolves.toEqual({
            id: 'peer-origin',
            enabled: true,
            priority: 5,
            replaced: false,
            contentLength: 40,
            truncated: false,
        });
    });

    it('rejects enabled contributor updates without content at the schema boundary', async () => {
        const { agent, upsertSessionSystemPromptContributor } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 'peer-origin',
            }),
        });

        expect(response.status).toBe(400);
        expect(upsertSessionSystemPromptContributor).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toMatchObject({
            code: 'validation_failed',
            scope: 'validation',
            type: 'user',
            endpoint: '/sessions/session-1/system-prompt/contributors',
            method: 'POST',
            context: {
                issues: [
                    {
                        path: ['content'],
                        message: 'Contributor content is required when enabled',
                    },
                ],
            },
        });
    });

    it('rejects non-integer contributor priority at the schema boundary', async () => {
        const { agent, upsertSessionSystemPromptContributor } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 'peer-origin',
                priority: 4.5,
                content: 'Return the answer to the origin session.',
            }),
        });

        expect(response.status).toBe(400);
        expect(upsertSessionSystemPromptContributor).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toMatchObject({
            code: 'validation_failed',
            scope: 'validation',
            type: 'user',
            endpoint: '/sessions/session-1/system-prompt/contributors',
            method: 'POST',
            context: {
                issues: [
                    expect.objectContaining({
                        path: ['priority'],
                    }),
                ],
            },
        });
    });

    it('removes session system prompt contributors when disabled', async () => {
        const { agent, removeSessionSystemPromptContributor } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 'peer-origin',
                enabled: false,
            }),
        });

        expect(response.status).toBe(200);
        expect(removeSessionSystemPromptContributor).toHaveBeenCalledWith(
            'session-1',
            'peer-origin'
        );
        await expect(response.json()).resolves.toEqual({
            id: 'peer-origin',
            enabled: false,
            removed: true,
        });
    });

    it('rejects contributor content that becomes empty after truncation', async () => {
        const { agent, upsertSessionSystemPromptContributor } = createAgent();
        const app = createSessionsRouter(async () => agent);

        const response = await app.request('/sessions/session-1/system-prompt/contributors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                id: 'peer-origin',
                content: `${' '.repeat(120000)}x`,
            }),
        });

        expect(response.status).toBe(400);
        expect(upsertSessionSystemPromptContributor).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toMatchObject({
            code: 'session_systemprompt_contributor_config_invalid',
            message: 'Contributor content is required when enabled',
            scope: 'system_prompt',
            type: 'user',
            endpoint: '/sessions/session-1/system-prompt/contributors',
            method: 'POST',
        });
    });
});
