import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'dexto-openrouter-schema-test-'));
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

describe('LLMConfigSchema OpenRouter validation', () => {
    it('accepts known OpenRouter models and rejects unknown ones when cache is populated', async () => {
        const fetchMock = createFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        const { refreshOpenRouterModelCache } = await import(
            './providers/openrouter-model-registry.js'
        );
        await refreshOpenRouterModelCache({ force: true, apiKey: 'sk-test' });

        const { LLMConfigSchema } = await import('./schemas.js');

        const validConfig = LLMConfigSchema.safeParse({
            provider: 'openrouter',
            model: 'openai/gpt-4o-mini',
            apiKey: 'sk-test',
        });
        expect(validConfig.success).toBe(true);

        const invalidConfig = LLMConfigSchema.safeParse({
            provider: 'openrouter',
            model: 'totally/unknown-model',
            apiKey: 'sk-test',
        });
        expect(invalidConfig.success).toBe(false);
        if (!invalidConfig.success) {
            expect(invalidConfig.error.issues[0]?.message).toContain(
                'not available via OpenRouter'
            );
        }
    });
});
