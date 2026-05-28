import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import { getDefaultModelForProvider, type LLMProvider } from '@dexto/core';
import {
    getProviderAuthDefinitions,
    saveApiKeyModelAuthProfile,
    saveChatGPTLoginModelAuthProfile,
    startChatGPTBrowserLogin,
    globalPreferencesExist,
    loadGlobalPreferences,
    updateGlobalPreferences,
    type AuthMethodDefinition,
    type ProviderAuthDefinition,
} from '@dexto/agent-management';
import { interactiveApiKeySetup } from '../utils/api-key-setup.js';
import { getProviderDisplayName } from '../utils/provider-setup.js';

export type ConnectCommandOptions = {
    provider?: string;
    method?: string;
    interactive?: boolean;
};

const CHATGPT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function getSelectableProviderDefinitions(): readonly ProviderAuthDefinition[] {
    return getProviderAuthDefinitions().filter(
        (provider: ProviderAuthDefinition) => provider.methods.length > 0
    );
}

async function selectProvider(input: string | undefined): Promise<LLMProvider | null> {
    const providers = getSelectableProviderDefinitions();
    if (input) {
        const provider = providers.find(
            (candidate: ProviderAuthDefinition) => candidate.providerId === input
        );
        if (!provider) {
            throw new Error(`Unsupported model auth provider: ${input}`);
        }
        return provider.providerId;
    }

    const selected = await p.select({
        message: 'Choose a model provider to connect',
        options: providers.map((provider: ProviderAuthDefinition) => ({
            value: provider.providerId,
            label: provider.label,
        })),
    });

    return p.isCancel(selected) ? null : (selected as LLMProvider);
}

async function selectMethod(
    providerId: LLMProvider,
    input: string | undefined
): Promise<string | null> {
    const provider = getProviderAuthDefinitions().find(
        (item: ProviderAuthDefinition) => item.providerId === providerId
    );
    if (!provider) {
        throw new Error(`Unsupported model auth provider: ${providerId}`);
    }

    if (input) {
        const method = provider.methods.find(
            (candidate: AuthMethodDefinition) => candidate.id === input
        );
        if (!method) {
            throw new Error(`Unsupported auth method for ${providerId}: ${input}`);
        }
        return method.id;
    }

    const selected = await p.select({
        message: `How do you want to connect ${provider.label}?`,
        options: provider.methods.map((method: AuthMethodDefinition) => ({
            value: method.id,
            label: method.label,
            ...(method.hint ? { hint: method.hint } : {}),
        })),
    });

    return p.isCancel(selected) ? null : (selected as string);
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
    let login: Awaited<ReturnType<typeof startChatGPTBrowserLogin>> | null = null;
    let timeout: NodeJS.Timeout | null = null;

    try {
        spinner.start('Starting ChatGPT Login');
        login = await startChatGPTBrowserLogin();

        spinner.stop('OpenAI authorization ready');
        const openedBrowser = await open(login.authUrl)
            .then(() => true)
            .catch(() => false);
        if (openedBrowser) {
            p.note('Complete authorization in your browser.', 'ChatGPT Login');
        } else {
            p.note(
                `Open this URL in your browser:\n\n${chalk.cyan(login.authUrl)}`,
                'ChatGPT Login'
            );
        }

        spinner.start('Waiting for authorization');
        const credential = await Promise.race([
            login.waitForCredential(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error('ChatGPT Login timed out')),
                    CHATGPT_LOGIN_TIMEOUT_MS
                );
            }),
        ]);

        await saveChatGPTLoginModelAuthProfile(credential);
        await syncOpenAIConnectionToPreferences();
        spinner.stop('ChatGPT account connected');
        p.log.success('OpenAI ChatGPT Login connected');
    } catch (error) {
        spinner.stop('ChatGPT Login failed');
        throw error;
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
        await login?.cancel();
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
        .find((provider: ProviderAuthDefinition) => provider.providerId === providerId)
        ?.methods.find((candidate: AuthMethodDefinition) => candidate.id === methodId);
    if (!method) {
        throw new Error(`Unsupported auth method: ${providerId}/${methodId}`);
    }

    if (method.kind === 'api_key') {
        await connectApiKey(providerId);
        p.outro(chalk.green('Connection saved'));
        return;
    }

    if (providerId === 'openai' && method.id === 'chatgpt_login' && method.kind === 'oauth') {
        await connectOpenAIChatGPTLogin();
        p.outro(chalk.green('Connection saved'));
        return;
    }

    throw new Error(`Auth method is not implemented yet: ${providerId}/${method.id}`);
}
