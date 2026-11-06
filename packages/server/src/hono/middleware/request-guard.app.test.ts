import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDextoApp } from '../index.js';
import { ApprovalCoordinator } from '../../approval/approval-coordinator.js';
import { WebhookEventSubscriber } from '../../events/webhook-subscriber.js';
import { A2ASseEventSubscriber } from '../../events/a2a-sse-subscriber.js';
import { SessionSseEventSubscriber } from '../../events/session-sse-subscriber.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('createDextoApp guard wiring', () => {
    function makeApp(disableAuth = false) {
        return createDextoApp({
            getAgent: (() => {
                throw new Error('agent not needed');
            }) as never,
            getAgentCard: () => ({}) as never,
            approvalCoordinator: new ApprovalCoordinator(),
            webhookSubscriber: new WebhookEventSubscriber(),
            sseSubscriber: new A2ASseEventSubscriber(),
            sessionSseSubscriber: new SessionSseEventSubscriber(),
            disableAuth,
        });
    }

    function clearAuthEnv() {
        vi.stubEnv('DEXTO_SERVER_API_KEY', '');
        vi.stubEnv('DEXTO_SERVER_REQUIRE_AUTH', '');
        vi.stubEnv('NODE_ENV', 'development');
    }

    it('checks Host when the server runs without auth', async () => {
        clearAuthEnv();
        const res = await makeApp().request('http://rebind.evil.example/health', {
            headers: { host: 'rebind.evil.example' },
        });
        expect(res.status).toBe(403);
    });

    it('does not check Host when an API key is configured', async () => {
        clearAuthEnv();
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'synthetic-key');
        const res = await makeApp().request('http://dexto.example.com/health', {
            headers: { host: 'dexto.example.com' },
        });
        expect(res.status).toBe(200);
    });

    it('does not check Host when built-in auth is disabled', async () => {
        clearAuthEnv();
        const res = await makeApp(true).request('http://dexto.example.com/health', {
            headers: { host: 'dexto.example.com' },
        });
        expect(res.status).toBe(200);
    });

    it('still rejects simple state-changing requests when an API key is configured', async () => {
        clearAuthEnv();
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'synthetic-key');
        const res = await makeApp().request('http://dexto.example.com/api/reset', {
            method: 'POST',
            headers: {
                host: 'dexto.example.com',
                authorization: 'Bearer synthetic-key',
                origin: 'https://evil.example',
            },
        });
        expect(res.status).toBe(403);
    });
});
