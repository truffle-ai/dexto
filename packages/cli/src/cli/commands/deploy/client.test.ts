import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAuthToken = vi.fn();
const mockGetDextoApiKey = vi.fn();
const mockLoadAuth = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock('../../auth/service.js', () => ({
    getAuthToken: mockGetAuthToken,
    getDextoApiKey: mockGetDextoApiKey,
    loadAuth: mockLoadAuth,
}));

vi.mock('@dexto/client-sdk', () => ({
    createMessageStream: vi.fn(),
}));

describe('createDeployClient auth resolution', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        delete process.env.DEXTO_API_KEY;
        delete process.env.DEXTO_API_URL;
        delete process.env.DEXTO_SANDBOX_URL;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('prefers the stored login API key over a different env key', async () => {
        mockLoadAuth.mockResolvedValue({
            createdAt: Date.now(),
            dextoApiKey: 'dxt_auth_key',
        });
        mockGetAuthToken.mockResolvedValue('jwt_token');
        mockGetDextoApiKey.mockResolvedValue('dxt_env_key');
        process.env.DEXTO_API_KEY = 'dxt_env_key';

        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: { cloudAgents: [] } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );

        const { createDeployClient } = await import('./client.js');
        await createDeployClient().listCloudAgents();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            method: 'GET',
            headers: expect.any(globalThis.Headers),
        });
        const headers = fetchMock.mock.calls[0]?.[1]?.headers as InstanceType<
            typeof globalThis.Headers
        >;
        expect(headers.get('Authorization')).toBe('Bearer dxt_auth_key');
    });

    it('falls back to the auth token when no stored API key exists', async () => {
        mockLoadAuth.mockResolvedValue({
            createdAt: Date.now(),
            token: 'jwt_token',
        });
        mockGetAuthToken.mockResolvedValue('jwt_token');
        mockGetDextoApiKey.mockResolvedValue(null);

        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: { cloudAgents: [] } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );

        const { createDeployClient } = await import('./client.js');
        await createDeployClient().listCloudAgents();

        const headers = fetchMock.mock.calls[0]?.[1]?.headers as InstanceType<
            typeof globalThis.Headers
        >;
        expect(headers.get('Authorization')).toBe('Bearer jwt_token');
    });
});
