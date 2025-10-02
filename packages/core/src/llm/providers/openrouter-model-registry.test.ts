import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

let tempHome: string;

const createFetchMock = () =>
    vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            data: [{ id: 'openai/gpt-4o-mini' }, { id: 'anthropic/claude-3-5-sonnet-20241022' }],
        }),
        text: async () => '',
    }));

beforeEach(() => {
    vi.resetModules();
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'dexto-openrouter-test-'));
    process.env.HOME = tempHome;
    if (process.platform === 'win32') {
        process.env.USERPROFILE = tempHome;
    }
});

afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(tempHome, { recursive: true, force: true });
});

afterAll(() => {
    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }

    if (process.platform === 'win32') {
        if (originalUserProfile === undefined) {
            delete process.env.USERPROFILE;
        } else {
            process.env.USERPROFILE = originalUserProfile;
        }
    }
});

describe('OpenRouter model registry', () => {
    it('refreshes cache and validates models', async () => {
        const fetchMock = createFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        const {
            refreshOpenRouterModelCache,
            lookupOpenRouterModel,
            getCachedOpenRouterModels,
            __TEST_ONLY__,
        } = await import('./openrouter-model-registry.js');

        await refreshOpenRouterModelCache({ force: true, apiKey: 'sk-test' });

        expect(lookupOpenRouterModel('openai/gpt-4o-mini')).toBe('valid');
        expect(lookupOpenRouterModel('anthropic/claude-3-5-sonnet-20241022')).toBe('valid');
        expect(lookupOpenRouterModel('unknown/provider-model')).toBe('invalid');

        const cachedModels = getCachedOpenRouterModels();
        expect(cachedModels).not.toBeNull();
        expect(cachedModels).toContain('openai/gpt-4o-mini');

        expect(existsSync(__TEST_ONLY__.cachePath)).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('treats stale cache as unknown and schedules background refresh', async () => {
        vi.useFakeTimers();

        const fetchMock = createFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        const { refreshOpenRouterModelCache, lookupOpenRouterModel, __TEST_ONLY__ } = await import(
            './openrouter-model-registry.js'
        );

        const initialTime = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(initialTime);
        await refreshOpenRouterModelCache({ force: true });

        expect(lookupOpenRouterModel('openai/gpt-4o-mini')).toBe('valid');

        vi.setSystemTime(initialTime.getTime() + __TEST_ONLY__.CACHE_TTL_MS + 1000);
        const lookupResult = lookupOpenRouterModel('openai/gpt-4o-mini');
        expect(lookupResult).toBe('unknown');

        // Allow pending refresh to run
        await vi.runAllTimersAsync();
        vi.useRealTimers();
    });
});
