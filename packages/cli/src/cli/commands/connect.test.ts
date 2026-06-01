import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConnectCommand } from './connect.js';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    logSuccess: vi.fn(),
    logWarn: vi.fn(),
    spinner: {
        start: vi.fn(),
        stop: vi.fn(),
    },
    open: vi.fn(),
    pendingLogin: {
        authUrl: 'https://auth.openai.com/oauth/authorize',
        waitForProfile: vi.fn(),
        cancel: vi.fn(),
    },
    startModelAuthBrowserLogin: vi.fn(),
    interactiveApiKeySetup: vi.fn(),
    saveApiKeyProfile: vi.fn(),
    listSavedProfiles: vi.fn(),
    getDefaultProfileId: vi.fn(),
    setDefaultProfile: vi.fn(),
    deleteProfile: vi.fn(),
    markProviderConnected: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    select: mocks.select,
    intro: mocks.intro,
    outro: mocks.outro,
    cancel: mocks.cancel,
    note: mocks.note,
    isCancel: vi.fn(() => false),
    log: {
        success: mocks.logSuccess,
        warn: mocks.logWarn,
    },
    spinner: vi.fn(() => mocks.spinner),
}));

vi.mock('open', () => ({
    default: mocks.open,
}));

vi.mock('@dexto/llm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/llm')>();
    return {
        ...actual,
        getDefaultModelForProvider: vi.fn(() => 'gpt-5.4'),
    };
});

vi.mock('../utils/api-key-setup.js', () => ({
    interactiveApiKeySetup: mocks.interactiveApiKeySetup,
}));

vi.mock('@dexto/agent-management', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/agent-management')>();
    return {
        ...actual,
        deleteModelAuthProfile: mocks.deleteProfile,
        getDefaultModelAuthProfileIdForProvider: mocks.getDefaultProfileId,
        listSavedModelAuthProfiles: mocks.listSavedProfiles,
        markModelAuthProviderConnected: mocks.markProviderConnected,
        saveApiKeyModelAuthProfile: mocks.saveApiKeyProfile,
        setDefaultModelAuthProfile: mocks.setDefaultProfile,
        startModelAuthBrowserLogin: mocks.startModelAuthBrowserLogin,
    };
});

describe('handleConnectCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.startModelAuthBrowserLogin.mockResolvedValue(mocks.pendingLogin);
        mocks.pendingLogin.waitForProfile.mockResolvedValue({
            id: 'openai:chatgpt_login',
            providerId: 'openai',
            methodId: 'chatgpt_login',
            label: 'ChatGPT Login',
            credential: {
                type: 'oauth',
                issuer: 'https://auth.openai.com',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
                expiresAt: Date.now() + 3600_000,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        mocks.pendingLogin.cancel.mockResolvedValue(undefined);
        mocks.open.mockResolvedValue(undefined);
        mocks.listSavedProfiles.mockResolvedValue([]);
        mocks.getDefaultProfileId.mockResolvedValue(null);
        mocks.setDefaultProfile.mockResolvedValue(undefined);
        mocks.deleteProfile.mockResolvedValue(true);
        mocks.markProviderConnected.mockResolvedValue(undefined);
    });

    it('saves an OpenAI API-key profile after API key setup succeeds', async () => {
        mocks.interactiveApiKeySetup.mockResolvedValue({ success: true, apiKey: 'sk-test' });

        await handleConnectCommand({
            provider: 'openai',
            method: 'api_key',
        });

        expect(mocks.interactiveApiKeySetup).toHaveBeenCalledWith('openai', {
            exitOnCancel: false,
            model: 'gpt-5.4',
        });
        expect(mocks.saveApiKeyProfile).toHaveBeenCalledWith('openai');
        expect(mocks.startModelAuthBrowserLogin).not.toHaveBeenCalled();
    });

    it('runs native ChatGPT Login and saves the OAuth-backed OpenAI profile', async () => {
        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
        });

        expect(mocks.startModelAuthBrowserLogin).toHaveBeenCalledWith({
            providerId: 'openai',
            methodId: 'chatgpt_login',
        });
        expect(mocks.open).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize');
        expect(mocks.note).toHaveBeenCalledWith(
            'Complete authorization in your browser.',
            'ChatGPT Login'
        );
        expect(mocks.pendingLogin.waitForProfile).toHaveBeenCalled();
        expect(mocks.pendingLogin.cancel).toHaveBeenCalled();
    });

    it('offers provider auth definitions through the interactive picker', async () => {
        mocks.select.mockResolvedValueOnce('openai').mockResolvedValueOnce('chatgpt_login');

        await handleConnectCommand();

        expect(mocks.select).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                options: expect.arrayContaining([
                    expect.objectContaining({ value: 'openai', label: 'OpenAI' }),
                ]),
            })
        );
        expect(mocks.select).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                options: expect.arrayContaining([
                    expect.objectContaining({ value: 'api_key', label: 'API key' }),
                    expect.objectContaining({
                        value: 'chatgpt_login',
                        label: 'ChatGPT Login',
                    }),
                ]),
            })
        );
        expect(mocks.pendingLogin.waitForProfile).toHaveBeenCalled();
    });

    it('keeps waiting for ChatGPT Login after the browser open helper fails', async () => {
        mocks.open.mockRejectedValueOnce(new Error('no browser'));

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
        });

        expect(mocks.note).toHaveBeenCalledWith(
            expect.stringContaining('https://auth.openai.com/oauth/authorize'),
            'ChatGPT Login'
        );
        expect(mocks.pendingLogin.waitForProfile).toHaveBeenCalled();
    });

    it('does not save ChatGPT Login when native authorization fails', async () => {
        mocks.pendingLogin.waitForProfile.mockRejectedValueOnce(new Error('authorization failed'));

        await expect(
            handleConnectCommand({
                provider: 'openai',
                method: 'chatgpt_login',
            })
        ).rejects.toThrow('authorization failed');
        expect(mocks.pendingLogin.cancel).toHaveBeenCalled();
    });

    it('clears OpenAI apiKeyPending when connected auth satisfies current OpenAI preferences', async () => {
        mocks.interactiveApiKeySetup.mockResolvedValue({ success: true, apiKey: 'sk-test' });

        await handleConnectCommand({
            provider: 'openai',
            method: 'api_key',
        });

        expect(mocks.markProviderConnected).toHaveBeenCalledWith('openai');
    });

    it('does not report a saved connection when API-key setup is cancelled', async () => {
        mocks.interactiveApiKeySetup.mockResolvedValue({ success: false, cancelled: true });

        await handleConnectCommand({
            provider: 'openai',
            method: 'api_key',
        });

        expect(mocks.saveApiKeyProfile).not.toHaveBeenCalled();
        expect(mocks.outro).not.toHaveBeenCalled();
        expect(mocks.logWarn).toHaveBeenCalledWith('Connection cancelled');
    });

    it('uses an existing profile without reconnecting', async () => {
        mocks.listSavedProfiles.mockResolvedValue([
            {
                id: 'openai:chatgpt_login',
                providerId: 'openai',
                methodId: 'chatgpt_login',
                label: 'ChatGPT Login',
                credential: {
                    type: 'oauth',
                    issuer: 'https://auth.openai.com',
                    refreshToken: 'refresh-token',
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 3600_000,
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ]);

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
            action: 'use',
        });

        expect(mocks.setDefaultProfile).toHaveBeenCalledWith({
            providerId: 'openai',
            profileId: 'openai:chatgpt_login',
        });
        expect(mocks.startModelAuthBrowserLogin).not.toHaveBeenCalled();
    });

    it('deletes an existing profile without reconnecting', async () => {
        mocks.listSavedProfiles.mockResolvedValue([
            {
                id: 'openai:chatgpt_login',
                providerId: 'openai',
                methodId: 'chatgpt_login',
                label: 'ChatGPT Login',
                credential: {
                    type: 'oauth',
                    issuer: 'https://auth.openai.com',
                    refreshToken: 'refresh-token',
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 3600_000,
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ]);

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
            action: 'delete',
            interactive: false,
        });

        expect(mocks.deleteProfile).toHaveBeenCalledWith('openai:chatgpt_login');
        expect(mocks.startModelAuthBrowserLogin).not.toHaveBeenCalled();
    });

    it('replaces an existing profile when requested', async () => {
        mocks.listSavedProfiles.mockResolvedValue([
            {
                id: 'openai:chatgpt_login',
                providerId: 'openai',
                methodId: 'chatgpt_login',
                label: 'ChatGPT Login',
                credential: {
                    type: 'oauth',
                    issuer: 'https://auth.openai.com',
                    refreshToken: 'refresh-token',
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 3600_000,
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ]);

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
            action: 'replace',
        });

        expect(mocks.startModelAuthBrowserLogin).toHaveBeenCalledWith({
            providerId: 'openai',
            methodId: 'chatgpt_login',
        });
        expect(mocks.pendingLogin.waitForProfile).toHaveBeenCalled();
    });

    it('rejects unsupported existing-profile actions', async () => {
        await expect(
            handleConnectCommand({
                provider: 'openai',
                method: 'chatgpt_login',
                action: 'nope',
            })
        ).rejects.toThrow('Unsupported connect action: nope');
        expect(mocks.startModelAuthBrowserLogin).not.toHaveBeenCalled();
    });
});
