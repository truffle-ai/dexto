import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    deleteModelAuthProfile,
    getDefaultModelAuthProfile,
    getDefaultModelAuthProfileIdForProvider,
    getModelAuthProfileId,
    getModelAuthProfilesPath,
    listModelAuthProfiles,
    loadModelAuthProfiles,
    saveApiKeyModelAuthProfile,
    setDefaultModelAuthProfile,
    upsertModelAuthProfile,
} from './model-auth-profiles.js';
import {
    createModelAuthResolver,
    saveChatGPTLoginModelAuthProfile,
} from './model-auth-handlers.js';

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
            credential: {
                type: 'api_key_env',
                envVar: 'OPENAI_API_KEY',
            },
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
            credential: {
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
                expiresAt: chatgptCredential.expiresAt,
                metadata: { accountId: 'account-1' },
            },
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

    it('stores, defaults, lists, and deletes generic provider auth profiles', async () => {
        await upsertModelAuthProfile({
            id: getModelAuthProfileId('minimax', 'portal_login'),
            providerId: 'minimax',
            methodId: 'portal_login',
            label: 'MiniMax Portal',
            credential: {
                type: 'oauth',
                issuer: 'https://example.test',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
                expiresAt: 1,
                metadata: { accountId: 'account-1' },
            },
        });

        let profiles = await loadModelAuthProfiles();
        expect(getDefaultModelAuthProfile(profiles, 'minimax')?.id).toBe('minimax:portal_login');
        expect(listModelAuthProfiles(profiles, 'minimax')).toHaveLength(1);

        await setDefaultModelAuthProfile({ providerId: 'minimax', profileId: null });
        expect(await getDefaultModelAuthProfileIdForProvider('minimax')).toBeNull();

        expect(await deleteModelAuthProfile('minimax:portal_login')).toBe(true);
        profiles = await loadModelAuthProfiles();
        expect(listModelAuthProfiles(profiles, 'minimax')).toHaveLength(0);
    });

    it('ignores defaults that point to another provider profile', async () => {
        await saveApiKeyModelAuthProfile('openai');
        const profilesPath = getModelAuthProfilesPath();
        mkdirSync(path.dirname(profilesPath), { recursive: true });
        writeFileSync(
            profilesPath,
            readFileSync(profilesPath, 'utf-8').replace(
                'openai: openai:api_key',
                'openai: openai:api_key\n  anthropic: openai:api_key'
            )
        );

        const profiles = await loadModelAuthProfiles();
        expect(getDefaultModelAuthProfile(profiles, 'anthropic')).toBeNull();
        expect(await getDefaultModelAuthProfileIdForProvider('anthropic')).toBeNull();
    });
});
