import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createModelAuthResolver,
    getDefaultModelAuthProfile,
    getModelAuthProfilesPath,
    loadModelAuthProfiles,
    saveApiKeyModelAuthProfile,
    saveChatGPTLoginModelAuthProfile,
} from './model-auth-profiles.js';

vi.mock('@dexto/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/core')>();
    return {
        ...actual,
        getDextoGlobalPath: vi.fn((type: string, filename?: string) => {
            const base = process.env.DEXTO_TEST_HOME ?? tmpdir();
            return filename ? path.join(base, type, filename) : path.join(base, type);
        }),
    };
});

describe('model auth profiles', () => {
    let home: string;
    let previousOpenAiApiKey: string | undefined;
    const chatgptCredential = {
        type: 'oauth' as const,
        issuer: 'https://auth.openai.com' as const,
        refreshToken: 'refresh-token',
        accessToken: 'access-token',
        expiresAt: Date.now() + 3600_000,
        accountId: 'account-1',
    };

    beforeEach(() => {
        home = mkdtempSync(path.join(tmpdir(), 'dexto-model-auth-'));
        process.env.DEXTO_TEST_HOME = home;
        previousOpenAiApiKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
        if (previousOpenAiApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = previousOpenAiApiKey;
        }
        delete process.env.DEXTO_TEST_HOME;
        rmSync(home, { recursive: true, force: true });
    });

    it('stores API-key profiles as provider defaults without storing the key', async () => {
        await saveApiKeyModelAuthProfile('openai');

        const profiles = await loadModelAuthProfiles();
        const profile = getDefaultModelAuthProfile(profiles, 'openai');

        expect(profile).toMatchObject({
            id: 'openai:api_key',
            providerId: 'openai',
            methodId: 'api_key',
            apiKeyEnvVar: 'OPENAI_API_KEY',
        });
        expect(readFileSync(getModelAuthProfilesPath(), 'utf-8')).not.toContain('sk-test');
    });

    it('stores ChatGPT Login as an OpenAI external-account default', async () => {
        await saveChatGPTLoginModelAuthProfile(chatgptCredential);

        const profiles = await loadModelAuthProfiles();
        const profile = getDefaultModelAuthProfile(profiles, 'openai');

        expect(profile).toMatchObject({
            id: 'openai:chatgpt_login',
            providerId: 'openai',
            methodId: 'chatgpt_login',
            credential: chatgptCredential,
        });
    });

    it('projects the default ChatGPT Login profile to native ChatGPT runtime auth', async () => {
        await saveChatGPTLoginModelAuthProfile(chatgptCredential);

        const runtimeAuth = createModelAuthResolver().resolveRuntimeAuth({
            provider: 'openai',
            model: 'gpt-5.4',
        });

        expect(runtimeAuth).toMatchObject({
            apiKey: 'dexto-chatgpt-oauth',
            baseURL: 'https://chatgpt.com/backend-api/codex',
        });
        expect(runtimeAuth?.fetch).toBeTypeOf('function');
    });

    it('projects API-key profiles from the provider environment variable', async () => {
        process.env.OPENAI_API_KEY = 'sk-test';
        await saveApiKeyModelAuthProfile('openai');

        expect(
            createModelAuthResolver().resolveRuntimeAuth({
                provider: 'openai',
                model: 'gpt-5.4',
            })
        ).toEqual({ apiKey: 'sk-test' });
    });
});
