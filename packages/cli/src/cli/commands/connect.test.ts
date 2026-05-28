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
    client: {
        readAccount: vi.fn(),
        startLogin: vi.fn(),
        waitForLoginCompleted: vi.fn(),
        close: vi.fn(),
    },
    createCodexClient: vi.fn(),
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
        CodexAppServerClient: {
            create: mocks.createCodexClient,
        },
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
        globalPreferencesExist: mocks.globalPreferencesExist,
        loadGlobalPreferences: mocks.loadGlobalPreferences,
        updateGlobalPreferences: mocks.updateGlobalPreferences,
    };
});

describe('handleConnectCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createCodexClient.mockResolvedValue(mocks.client);
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

    it('runs ChatGPT Login through the Codex app server and saves the OpenAI profile', async () => {
        mocks.client.readAccount.mockResolvedValueOnce({
            account: null,
            requiresOpenaiAuth: true,
        });
        mocks.client.startLogin.mockResolvedValue({
            type: 'chatgpt',
            loginId: 'login-1',
            authUrl: 'https://auth.openai.com/oauth/authorize',
        });
        mocks.client.waitForLoginCompleted.mockResolvedValue({
            loginId: 'login-1',
            success: true,
            error: null,
        });
        mocks.client.readAccount.mockResolvedValueOnce({
            account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' },
            requiresOpenaiAuth: false,
        });

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
        });

        expect(mocks.client.startLogin).toHaveBeenCalledWith({ type: 'chatgpt' });
        expect(mocks.open).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize');
        expect(mocks.client.waitForLoginCompleted).toHaveBeenCalledWith('login-1', {
            timeoutMs: 300000,
        });
        expect(mocks.saveChatGPTProfile).toHaveBeenCalled();
        expect(mocks.client.close).toHaveBeenCalled();
    });

    it('offers provider auth definitions through the interactive picker', async () => {
        mocks.select.mockResolvedValueOnce('openai').mockResolvedValueOnce('chatgpt_login');
        mocks.client.readAccount.mockResolvedValue({
            account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' },
            requiresOpenaiAuth: false,
        });

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
        mocks.client.readAccount.mockResolvedValueOnce({
            account: null,
            requiresOpenaiAuth: true,
        });
        mocks.client.startLogin.mockResolvedValue({
            type: 'chatgpt',
            loginId: 'login-1',
            authUrl: 'https://auth.openai.com/oauth/authorize',
        });
        mocks.open.mockRejectedValueOnce(new Error('no browser'));
        mocks.client.waitForLoginCompleted.mockResolvedValue({
            loginId: 'login-1',
            success: true,
            error: null,
        });
        mocks.client.readAccount.mockResolvedValueOnce({
            account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' },
            requiresOpenaiAuth: false,
        });

        await handleConnectCommand({
            provider: 'openai',
            method: 'chatgpt_login',
        });

        expect(mocks.client.waitForLoginCompleted).toHaveBeenCalledWith('login-1', {
            timeoutMs: 300000,
        });
        expect(mocks.saveChatGPTProfile).toHaveBeenCalled();
    });

    it('does not save ChatGPT Login when the completed login did not create a ChatGPT account', async () => {
        mocks.client.readAccount.mockResolvedValueOnce({
            account: null,
            requiresOpenaiAuth: true,
        });
        mocks.client.startLogin.mockResolvedValue({
            type: 'chatgpt',
            loginId: 'login-1',
            authUrl: 'https://auth.openai.com/oauth/authorize',
        });
        mocks.client.waitForLoginCompleted.mockResolvedValue({
            loginId: 'login-1',
            success: true,
            error: null,
        });
        mocks.client.readAccount.mockResolvedValueOnce({
            account: null,
            requiresOpenaiAuth: true,
        });

        await expect(
            handleConnectCommand({
                provider: 'openai',
                method: 'chatgpt_login',
            })
        ).rejects.toThrow('ChatGPT Login completed but no ChatGPT account was found');
        expect(mocks.saveChatGPTProfile).not.toHaveBeenCalled();
        expect(mocks.client.close).toHaveBeenCalled();
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
