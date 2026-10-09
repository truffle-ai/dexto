import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCloudDiscovery } from './discovery.js';

const auth = vi.hoisted(() => ({ getDextoApiKey: vi.fn(), loadAuth: vi.fn() }));
vi.mock('../../auth/service.js', () => auth);

describe('Cloud CLI discovery', () => {
    beforeEach(() => {
        auth.getDextoApiKey.mockResolvedValue('fixture-key');
        auth.loadAuth.mockResolvedValue({
            dextoApiKey: 'fixture-key',
            dextoPlatformUrl: 'https://preview.example.com',
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('prints one JSON sources result from the saved credential origin', async () => {
        const payload = { sources: [{ id: 'cloud', kind: 'platform', title: 'Dexto' }] };
        const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            Response.json(payload)
        );
        vi.stubGlobal('fetch', fetch);
        expect(
            await runCloudDiscovery({ command: 'sources' }, { json: true, limit: '2', offset: '3' })
        ).toBe(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0]?.[0])).toBe(
            'https://preview.example.com/api/capabilities/sources?limit=2&offset=3'
        );
        expect(console.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(payload));
        expect(console.error).not.toHaveBeenCalled();
    });
    it('fails a conflicting custom origin before fetching', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect(
            await runCloudDiscovery(
                { command: 'sources' },
                { json: true, platformUrl: 'https://other.example.com' }
            )
        ).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
            error: { code: 'configuration_error' },
        });
    });
    it('uses a legacy saved key only with the default origin', async () => {
        auth.loadAuth.mockResolvedValue({ dextoApiKey: 'fixture-key' });
        const fetch = vi.fn(async (_url: RequestInfo | URL) => Response.json({ sources: [] }));
        vi.stubGlobal('fetch', fetch);
        expect(await runCloudDiscovery({ command: 'sources' }, { json: true })).toBe(0);
        expect(String(fetch.mock.calls[0]?.[0])).toBe(
            'https://app.dexto.ai/api/capabilities/sources'
        );
        expect(
            await runCloudDiscovery(
                { command: 'sources' },
                { json: true, platformUrl: 'http://localhost:8787' }
            )
        ).toBe(1);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('allows an explicit different environment credential for a custom platform', async () => {
        auth.getDextoApiKey.mockResolvedValue('explicit-key');
        const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            Response.json({ sources: [] })
        );
        vi.stubGlobal('fetch', fetch);
        expect(
            await runCloudDiscovery(
                { command: 'sources' },
                { json: true, platformUrl: 'http://localhost:8787' }
            )
        ).toBe(0);
        expect(String(fetch.mock.calls[0]?.[0])).toBe(
            'http://localhost:8787/api/capabilities/sources'
        );
        expect(new globalThis.Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
            'Bearer explicit-key'
        );
    });
    it('keeps origin binding when the environment contains the same saved key', async () => {
        vi.stubEnv('DEXTO_API_KEY', 'fixture-key');
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect(
            await runCloudDiscovery(
                { command: 'sources' },
                { json: true, platformUrl: 'https://other.example.com' }
            )
        ).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('prints a machine-readable login instruction without networking', async () => {
        auth.getDextoApiKey.mockResolvedValue(null);
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect(await runCloudDiscovery({ command: 'sources' }, { json: true })).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('dexto login');
    });
});
