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
        waitForCredential: vi.fn(),
        cancel: vi.fn(),
    },
    startChatGPTBrowserLogin: vi.fn(),
    interactiveApiKeySetup: vi.fn(),
    saveApiKeyProfile: vi.fn(),
    saveChatGPTProfile: vi.fn(),
    globalPreferencesExist: vi.fn(),
    loadGlobalPreferences: vi.fn(),
    updateGlobalPreferences: vi.fn(),
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

vi.mock('@dexto/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/core')>();
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
        saveApiKeyModelAuthProfile: mocks.saveApiKeyProfile,
        saveChatGPTLoginModelAuthProfile: mocks.saveChatGPTProfile,
        startChatGPTBrowserLogin: mocks.startChatGPTBrowserLogin,
        globalPreferencesExist: mocks.globalPreferencesExist,
        loadGlobalPreferences: mocks.loadGlobalPreferences,
        updateGlobalPreferences: mocks.updateGlobalPreferences,
    };
});

describe('handleConnectCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.startChatGPTBrowserLogin.mockResolvedValue(mocks.pendingLogin);
        mocks.pendingLogin.waitForCredential.mockResolvedValue({
            type: 'oauth',
            issuer: 'https://auth.openai.com',
            refreshToken: 'refresh-token',
            accessToken: 'access-token',
            expiresAt: Date.now() + 3600_000,
            accountId: 'account-1',
        });
        mocks.pendingLogin.cancel.mockResolvedValue(undefined);
        mocks.open.mockResolvedValue(undefined);
        mocks.globalPreferencesExist.mockReturnValue(false);
        mocks.loadGlobalPreferences.mockResolvedValue({
            llm: { provider: 'openai', model: 'gpt-5.4' },
        });
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
        expect(mocks.saveChatGPTProfile).not.toHaveBeenCalled();
    });

    it('runs native ChatGPT Login and saves the OAuth-backed OpenAI profile', async () => {
        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
        });

        expect(mocks.startChatGPTBrowserLogin).toHaveBeenCalled();
        expect(mocks.open).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize');
        expect(mocks.note).toHaveBeenCalledWith(
            'Complete authorization in your browser.',
            'ChatGPT Login'
        );
        expect(mocks.pendingLogin.waitForCredential).toHaveBeenCalled();
        expect(mocks.saveChatGPTProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'oauth',
                refreshToken: 'refresh-token',
                accessToken: 'access-token',
            })
        );
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
        expect(mocks.saveChatGPTProfile).toHaveBeenCalled();
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
        expect(mocks.pendingLogin.waitForCredential).toHaveBeenCalled();
        expect(mocks.saveChatGPTProfile).toHaveBeenCalled();
    });

    it('does not save ChatGPT Login when native authorization fails', async () => {
        mocks.pendingLogin.waitForCredential.mockRejectedValueOnce(
            new Error('authorization failed')
        );

        await expect(
            handleConnectCommand({
                provider: 'openai',
                method: 'chatgpt_login',
            })
        ).rejects.toThrow('authorization failed');
        expect(mocks.saveChatGPTProfile).not.toHaveBeenCalled();
        expect(mocks.pendingLogin.cancel).toHaveBeenCalled();
    });

    it('clears OpenAI apiKeyPending when connected auth satisfies current OpenAI preferences', async () => {
        mocks.globalPreferencesExist.mockReturnValue(true);
        mocks.interactiveApiKeySetup.mockResolvedValue({ success: true, apiKey: 'sk-test' });

        await handleConnectCommand({
            provider: 'openai',
            method: 'api_key',
        });

        expect(mocks.updateGlobalPreferences).toHaveBeenCalledWith({
            setup: { apiKeyPending: false },
        });
    });
});
