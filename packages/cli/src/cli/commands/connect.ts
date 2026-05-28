import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import { CodexAppServerClient, getDefaultModelForProvider, type LLMProvider } from '@dexto/core';
import {
    getProviderAuthDefinitions,
    isExternalAccountAuthMethod,
    saveApiKeyModelAuthProfile,
    saveChatGPTLoginModelAuthProfile,
    globalPreferencesExist,
    loadGlobalPreferences,
    updateGlobalPreferences,
} from '@dexto/agent-management';
import { interactiveApiKeySetup } from '../utils/api-key-setup.js';
import { getProviderDisplayName } from '../utils/provider-setup.js';

export type ConnectCommandOptions = {
    provider?: string;
    method?: string;
    interactive?: boolean;
};

const CHATGPT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function getSelectableProviderDefinitions() {
    return getProviderAuthDefinitions().filter((provider) => provider.methods.length > 0);
}

async function selectProvider(input: string | undefined): Promise<LLMProvider | null> {
    const providers = getSelectableProviderDefinitions();
    if (input) {
        const provider = providers.find((candidate) => candidate.providerId === input);
        if (!provider) {
            throw new Error(`Unsupported model auth provider: ${input}`);
        }
        return provider.providerId;
    }

    const selected = await p.select({
        message: 'Choose a model provider to connect',
        options: providers.map((provider) => ({
            value: provider.providerId,
            label: provider.label,
        })),
    });

    return p.isCancel(selected) ? null : selected;
}

async function selectMethod(
    providerId: LLMProvider,
    input: string | undefined
): Promise<string | null> {
    const provider = getProviderAuthDefinitions().find((item) => item.providerId === providerId);
    if (!provider) {
        throw new Error(`Unsupported model auth provider: ${providerId}`);
    }

    if (input) {
        const method = provider.methods.find((candidate) => candidate.id === input);
        if (!method) {
            throw new Error(`Unsupported auth method for ${providerId}: ${input}`);
        }
        return method.id;
    }

    const selected = await p.select({
        message: `How do you want to connect ${provider.label}?`,
        options: provider.methods.map((method) => ({
            value: method.id,
            label: method.label,
            ...(method.hint ? { hint: method.hint } : {}),
        })),
    });

    return p.isCancel(selected) ? null : selected;
}

async function syncOpenAIConnectionToPreferences(): Promise<void> {
    if (!globalPreferencesExist()) {
        return;
    }

    const preferences = await loadGlobalPreferences();
    if (preferences.llm.provider !== 'openai') {
        return;
    }

    await updateGlobalPreferences({
        setup: {
            apiKeyPending: false,
        },
    });
}

async function connectApiKey(providerId: LLMProvider): Promise<void> {
    const defaultModel = getDefaultModelForProvider(providerId);
    const result = await interactiveApiKeySetup(providerId, {
        exitOnCancel: false,
        ...(defaultModel ? { model: defaultModel } : {}),
    });

    if (result.cancelled || result.skipped || !result.success) {
        p.log.warn('Connection cancelled');
        return;
    }

    await saveApiKeyModelAuthProfile(providerId);
    if (providerId === 'openai') {
        await syncOpenAIConnectionToPreferences();
    }

    p.log.success(`${getProviderDisplayName(providerId)} API key connected`);
}

async function connectOpenAIChatGPTLogin(): Promise<void> {
    const spinner = p.spinner();
    let client: CodexAppServerClient | null = null;

    try {
        spinner.start('Starting ChatGPT Login');
        client = await CodexAppServerClient.create();

        const account = await client.readAccount(false);
        if (account.account?.type === 'chatgpt') {
            spinner.stop('ChatGPT account already connected');
            await saveChatGPTLoginModelAuthProfile();
            await syncOpenAIConnectionToPreferences();
            p.log.success('OpenAI ChatGPT Login connected');
            return;
        }

        const login = await client.startLogin({ type: 'chatgpt' });
        if (login.type === 'chatgptAuthTokens') {
            spinner.stop('ChatGPT account connected');
            await saveChatGPTLoginModelAuthProfile();
            await syncOpenAIConnectionToPreferences();
            p.log.success('OpenAI ChatGPT Login connected');
            return;
        }

        if (login.type !== 'chatgpt') {
            throw new Error(`Unexpected Codex login response: ${login.type}`);
        }

        spinner.stop('OpenAI authorization ready');
        p.note(
            `Complete authorization in your browser.\n\n${chalk.cyan(login.authUrl)}`,
            'ChatGPT Login'
        );
        await open(login.authUrl).catch(() => undefined);

        spinner.start('Waiting for authorization');
        const completed = await client.waitForLoginCompleted(login.loginId, {
            timeoutMs: CHATGPT_LOGIN_TIMEOUT_MS,
        });
        if (!completed.success) {
            throw new Error(completed.error ?? 'ChatGPT Login failed');
        }

        const connected = await client.readAccount(true);
        if (connected.account?.type !== 'chatgpt') {
            throw new Error('ChatGPT Login completed but no ChatGPT account was found');
        }

        await saveChatGPTLoginModelAuthProfile();
        await syncOpenAIConnectionToPreferences();
        spinner.stop('ChatGPT account connected');
        p.log.success('OpenAI ChatGPT Login connected');
    } catch (error) {
        spinner.stop('ChatGPT Login failed');
        throw error;
    } finally {
        await client?.close();
    }
}

export async function handleConnectCommand(options: ConnectCommandOptions = {}): Promise<void> {
    if (options.interactive === false && (!options.provider || !options.method)) {
        throw new Error('Non-interactive connect requires --provider and --method');
    }

    p.intro(chalk.inverse('Connect Model Provider'));

    const providerId = await selectProvider(options.provider);
    if (!providerId) {
        p.cancel('Connection cancelled');
        return;
    }

    const methodId = await selectMethod(providerId, options.method);
    if (!methodId) {
        p.cancel('Connection cancelled');
        return;
    }

    const method = getProviderAuthDefinitions()
        .find((provider) => provider.providerId === providerId)
        ?.methods.find((candidate) => candidate.id === methodId);
    if (!method) {
        throw new Error(`Unsupported auth method: ${providerId}/${methodId}`);
    }

    if (method.kind === 'api_key') {
        await connectApiKey(providerId);
        p.outro(chalk.green('Connection saved'));
        return;
    }

    if (
        providerId === 'openai' &&
        method.id === 'chatgpt_login' &&
        isExternalAccountAuthMethod(method)
    ) {
        await connectOpenAIChatGPTLogin();
        p.outro(chalk.green('Connection saved'));
        return;
    }

    throw new Error(`Auth method is not implemented yet: ${providerId}/${method.id}`);
}
