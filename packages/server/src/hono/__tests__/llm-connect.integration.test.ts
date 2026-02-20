import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    createTestAgent,
    startTestServer,
    httpRequest,
    type TestServer,
    expectResponseStructure,
    validators,
} from './test-fixtures.js';

describe('LLM Connect Routes', () => {
    let testServer: TestServer | undefined;

    beforeAll(async () => {
        const agent = await createTestAgent();
        testServer = await startTestServer(agent);
    }, 30000);

    afterAll(async () => {
        if (testServer) {
            await testServer.cleanup();
        }
    });

    it('GET /api/llm/connect/providers returns curated providers', async () => {
        if (!testServer) throw new Error('Test server not initialized');
        const res = await httpRequest(testServer.baseUrl, 'GET', '/api/llm/connect/providers');
        expect(res.status).toBe(200);
        expectResponseStructure(res.body, { providers: validators.array });

        const providers = (res.body as { providers: Array<{ providerId: string }> }).providers;
        expect(providers.length).toBeGreaterThan(0);
        expect(providers.some((p) => p.providerId === 'openai')).toBe(true);
    });

    it('GET /api/llm/connect/profiles returns redacted profile list', async () => {
        if (!testServer) throw new Error('Test server not initialized');
        const res = await httpRequest(testServer.baseUrl, 'GET', '/api/llm/connect/profiles');
        expect(res.status).toBe(200);
        expectResponseStructure(res.body, {
            defaults: validators.object,
            profiles: validators.array,
        });
    });
});
