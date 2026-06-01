import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import { getDefaultModelForProvider, LLM_PROVIDERS, type LLMProvider } from '@dexto/llm';
import {
    deleteModelAuthProfile,
    getDefaultModelAuthProfileIdForProvider,
    getModelAuthProfileId,
    getProviderAuthDefinition,
    getProviderAuthDefinitions,
    listSavedModelAuthProfiles,
    markModelAuthProviderConnected,
    saveApiKeyModelAuthProfile,
    setDefaultModelAuthProfile,
    startModelAuthBrowserLogin,
    type AuthMethodDefinition,
    type ModelAuthProfile,
    type ProviderAuthDefinition,
} from '@dexto/agent-management';
import { interactiveApiKeySetup } from '../utils/api-key-setup.js';
import { getProviderDisplayName } from '../utils/provider-setup.js';

export type ConnectCommandAction = 'use' | 'replace' | 'delete';

export type ConnectCommandOptions = {
    provider?: string;
    method?: string;
    action?: string;
    interactive?: boolean;
};

const CHATGPT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function getSelectableProviderDefinitions(): readonly ProviderAuthDefinition[] {
    return getProviderAuthDefinitions().filter(
        (provider: ProviderAuthDefinition) => provider.methods.length > 0
    );
}

function toLlmProvider(providerId: string): LLMProvider {
    const provider = LLM_PROVIDERS.find((candidate) => candidate === providerId);
    if (!provider) {
        throw new Error(`API-key auth is not implemented for provider: ${providerId}`);
    }
    return provider;
}

function parseConnectAction(action: string | undefined): ConnectCommandAction | undefined {
    if (!action) {
        return undefined;
    }
    if (action === 'use' || action === 'replace' || action === 'delete') {
        return action;
    }
    throw new Error(`Unsupported connect action: ${action}`);
}

function methodHint(
    method: AuthMethodDefinition,
    profile: ModelAuthProfile | undefined,
    defaultProfileId: string | null
): string | undefined {
    const parts = [
        profile
            ? profile.id === defaultProfileId
                ? 'Connected (default)'
                : 'Connected'
            : undefined,
        method.hint,
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(' - ') : undefined;
}

async function selectProvider(input: string | undefined): Promise<ProviderAuthDefinition | null> {
    const providers = getSelectableProviderDefinitions();
    if (input) {
        const provider = providers.find(
            (candidate: ProviderAuthDefinition) => candidate.providerId === input
        );
        if (!provider) {
            throw new Error(`Unsupported model auth provider: ${input}`);
        }
        return provider;
    }

    const selected = await p.select({
        message: 'Choose a model provider to connect',
        options: providers.map((provider: ProviderAuthDefinition) => ({
            value: provider.providerId,
            label: provider.label,
        })),
    });

    return p.isCancel(selected) ? null : (getProviderAuthDefinition(selected as string) ?? null);
}

async function selectMethod(input: {
    provider: ProviderAuthDefinition;
    methodId?: string | undefined;
    profiles: ModelAuthProfile[];
    defaultProfileId: string | null;
}): Promise<AuthMethodDefinition | null> {
    if (input.methodId) {
        const method = input.provider.methods.find(
            (candidate: AuthMethodDefinition) => candidate.id === input.methodId
        );
        if (!method) {
            throw new Error(
                `Unsupported auth method for ${input.provider.providerId}: ${input.methodId}`
            );
        }
        return method;
    }

    const selected = await p.select({
        message: `How do you want to connect ${input.provider.label}?`,
        options: input.provider.methods.map((method: AuthMethodDefinition) => {
            const profile = input.profiles.find(
                (item) => item.id === getModelAuthProfileId(input.provider.providerId, method.id)
            );
            const hint = methodHint(method, profile, input.defaultProfileId);
            return {
                value: method.id,
                label: method.label,
                ...(hint ? { hint } : {}),
            };
        }),
    });

    return p.isCancel(selected)
        ? null
        : (input.provider.methods.find((method) => method.id === selected) ?? null);
}

async function selectExistingAction(input: {
    provider: ProviderAuthDefinition;
    method: AuthMethodDefinition;
    profile: ModelAuthProfile;
    defaultProfileId: string | null;
    action?: ConnectCommandAction | undefined;
    interactive: boolean;
}): Promise<ConnectCommandAction | null> {
    if (input.action) {
        return input.action;
    }

    if (!input.interactive) {
        return 'use';
    }

    const isDefault = input.profile.id === input.defaultProfileId;
    const selected = await p.select({
        message: `${input.provider.label} ${input.method.label} is already connected.`,
        options: [
            {
                value: 'use',
                label: isDefault ? 'Keep as default' : 'Use existing',
                hint: isDefault ? 'No changes' : 'Set as provider default',
            },
            {
                value: 'replace',
                label: 'Replace credentials',
                hint: 'Reconnect this method',
            },
            {
                value: 'delete',
                label: 'Delete credentials',
                ...(isDefault ? { hint: 'Also clears the provider default' } : {}),
            },
        ],
    });

    return p.isCancel(selected) ? null : (selected as ConnectCommandAction);
}

async function connectApiKey(providerId: LLMProvider): Promise<boolean> {
    const defaultModel = getDefaultModelForProvider(providerId);
    const result = await interactiveApiKeySetup(providerId, {
        exitOnCancel: false,
        ...(defaultModel ? { model: defaultModel } : {}),
    });

    if (result.cancelled || result.skipped || !result.success) {
        p.log.warn('Connection cancelled');
        return false;
    }

    await saveApiKeyModelAuthProfile(providerId);
    await markModelAuthProviderConnected(providerId);

    p.log.success(`${getProviderDisplayName(providerId)} API key connected`);
    return true;
}

async function connectBrowserOAuth(input: {
    provider: ProviderAuthDefinition;
    method: AuthMethodDefinition;
}): Promise<void> {
    const spinner = p.spinner();
    let login: Awaited<ReturnType<typeof startModelAuthBrowserLogin>> | null = null;
    let timeout: NodeJS.Timeout | null = null;

    try {
        spinner.start(`Starting ${input.method.label}`);
        login = await startModelAuthBrowserLogin({
            providerId: input.provider.providerId,
            methodId: input.method.id,
        });

        spinner.stop(`${input.provider.label} authorization ready`);
        const openedBrowser = await open(login.authUrl)
            .then(() => true)
            .catch(() => false);
        if (openedBrowser) {
            p.note('Complete authorization in your browser.', input.method.label);
        } else {
            p.note(
                `Open this URL in your browser:\n\n${chalk.cyan(login.authUrl)}`,
                input.method.label
            );
        }

        spinner.start('Waiting for authorization');
        await Promise.race([
            login.waitForProfile(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error(`${input.method.label} timed out`)),
                    CHATGPT_LOGIN_TIMEOUT_MS
                );
            }),
        ]);

        await markModelAuthProviderConnected(input.provider.providerId);
        spinner.stop(`${input.method.label} connected`);
        p.log.success(`${input.provider.label} ${input.method.label} connected`);
    } catch (error) {
        spinner.stop(`${input.method.label} failed`);
        throw error;
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
        await login?.cancel();
    }
}

async function connectProviderMethod(input: {
    provider: ProviderAuthDefinition;
    method: AuthMethodDefinition;
}): Promise<boolean> {
    if (input.method.kind === 'api_key') {
        return connectApiKey(toLlmProvider(input.provider.providerId));
    }

    if (input.method.kind === 'oauth') {
        await connectBrowserOAuth(input);
        return true;
    }

    return false;
}

export async function handleConnectCommand(options: ConnectCommandOptions = {}): Promise<void> {
    const interactive = options.interactive !== false;
    if (!interactive && (!options.provider || !options.method)) {
        throw new Error('Non-interactive connect requires --provider and --method');
    }
    const requestedAction = parseConnectAction(options.action);

    p.intro(chalk.inverse('Connect Model Provider'));

    const provider = await selectProvider(options.provider);
    if (!provider) {
        p.cancel('Connection cancelled');
        return;
    }

    const [profiles, defaultProfileId] = await Promise.all([
        listSavedModelAuthProfiles(provider.providerId),
        getDefaultModelAuthProfileIdForProvider(provider.providerId),
    ]);

    const method = await selectMethod({
        provider,
        methodId: options.method,
        profiles,
        defaultProfileId,
    });
    if (!method) {
        p.cancel('Connection cancelled');
        return;
    }

    const profileId = getModelAuthProfileId(provider.providerId, method.id);
    const existingProfile = profiles.find((profile: ModelAuthProfile) => profile.id === profileId);
    if (existingProfile) {
        const action = await selectExistingAction({
            provider,
            method,
            profile: existingProfile,
            defaultProfileId,
            action: requestedAction,
            interactive,
        });

        if (!action) {
            p.cancel('Connection cancelled');
            return;
        }

        if (action === 'use') {
            await setDefaultModelAuthProfile({ providerId: provider.providerId, profileId });
            p.outro(chalk.green(`Using ${provider.label} ${method.label}`));
            return;
        }

        if (action === 'delete') {
            const confirmed = interactive
                ? await p.confirm({
                      message: `Delete ${provider.label} ${method.label} credentials?`,
                      initialValue: false,
                  })
                : true;
            if (p.isCancel(confirmed) || !confirmed) {
                p.cancel('Connection cancelled');
                return;
            }
            await deleteModelAuthProfile(profileId);
            p.outro(chalk.green(`Deleted ${provider.label} ${method.label}`));
            return;
        }
    }

    const connected = await connectProviderMethod({ provider, method });
    if (connected) {
        p.outro(chalk.green('Connection saved'));
    }
}
