import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import type { CodexAppServerClient } from '@dexto/core';

import {
    PROVIDER_AUTH_DEFINITIONS,
    deleteLlmAuthProfile,
    getDefaultLlmAuthProfileId,
    getProviderAuthDefinition,
    listLlmAuthProfiles,
    setDefaultLlmAuthProfile,
    upsertLlmAuthProfile,
    type AuthMethodDefinition,
    type LlmAuthCredential,
    type ProviderAuthDefinition,
} from '@dexto/agent-management';
import {
    createCodexClientForChatGptLogin,
    ensureCodexChatGptSession,
    getCodexLoginErrorMessage,
} from '../../utils/codex-chatgpt-login.js';

function isCancel<T>(value: T | symbol): value is symbol {
    return p.isCancel(value);
}

function toProviderOption(provider: ProviderAuthDefinition): p.Option<string> {
    const hint = provider.methods.length > 1 ? `${provider.methods.length} methods` : undefined;
    return {
        value: provider.providerId,
        label: provider.label,
        ...(hint ? { hint } : {}),
    };
}

function defaultProfileId(providerId: string, methodId: string): string {
    return `${providerId}:${methodId}`;
}

function combineHint(...parts: Array<string | undefined>): string | undefined {
    const cleaned = parts
        .map((p) => p?.trim())
        .filter((p): p is string => Boolean(p && p.length > 0));
    return cleaned.length > 0 ? cleaned.join(' — ') : undefined;
}

type AuthProfile = Awaited<ReturnType<typeof listLlmAuthProfiles>>[number];

async function persistConnectedProfile(params: {
    profileId: string;
    provider: ProviderAuthDefinition;
    method: AuthMethodDefinition;
    credential: LlmAuthCredential;
}): Promise<void> {
    await upsertLlmAuthProfile({
        profileId: params.profileId,
        providerId: params.provider.providerId,
        methodId: params.method.id,
        label: params.method.label,
        credential: params.credential,
    });
}

async function connectExternalAccount(params: {
    provider: ProviderAuthDefinition;
    method: AuthMethodDefinition;
}): Promise<LlmAuthCredential | null> {
    if (params.provider.providerId !== 'openai' || params.method.id !== 'chatgpt_login') {
        throw new Error(
            `Unsupported external account method: ${params.provider.providerId}/${params.method.id}`
        );
    }

    let client: CodexAppServerClient | null = null;
    try {
        client = await createCodexClientForChatGptLogin();
        const account = await ensureCodexChatGptSession(client);
        if (!account || account.account?.type !== 'chatgpt') {
            return null;
        }

        return {
            type: 'external_account',
            system: 'codex',
            authMode: 'chatgpt',
            metadata: {
                email: account.account.email,
                planType: account.account.planType,
            },
        };
    } finally {
        await client?.close().catch(() => undefined);
    }
}

export async function handleConnectCommand(options?: { interactive?: boolean }): Promise<void> {
    if (options?.interactive === false) {
        throw new Error('Non-interactive connect is not implemented yet');
    }

    p.intro(chalk.inverse(' Connect Provider '));

    const providerId = await p.select({
        message: 'Choose a provider',
        options: PROVIDER_AUTH_DEFINITIONS.map(toProviderOption),
    });

    if (isCancel(providerId)) {
        p.cancel('Connect cancelled');
        return;
    }

    const provider = getProviderAuthDefinition(providerId as string);
    if (!provider) {
        p.cancel(`Unknown provider: ${providerId as string}`);
        return;
    }

    const existingProfiles = await listLlmAuthProfiles({ providerId: provider.providerId });
    const existingByProfileId = new Map(
        existingProfiles.map((profile: AuthProfile) => [profile.profileId, profile])
    );
    const defaultProfileIdForProvider = await getDefaultLlmAuthProfileId(provider.providerId);

    const methodId =
        provider.methods.length === 1
            ? provider.methods[0]!.id
            : await p.select({
                  message: `Choose a login method for ${provider.label}`,
                  options: provider.methods.map((method) => {
                      const profileId = defaultProfileId(provider.providerId, method.id);
                      const existing = existingByProfileId.get(profileId);
                      const connectedHint =
                          defaultProfileIdForProvider === profileId
                              ? 'Connected (default)'
                              : existing
                                ? 'Connected'
                                : undefined;
                      const hint = combineHint(connectedHint, method.hint);
                      return {
                          value: method.id,
                          label: method.label,
                          ...(hint ? { hint } : {}),
                      };
                  }),
              });

    if (isCancel(methodId)) {
        p.cancel('Connect cancelled');
        return;
    }

    const method = provider.methods.find((candidate) => candidate.id === methodId);
    if (!method) {
        p.cancel(`Unknown method: ${methodId as string}`);
        return;
    }

    const profileId = defaultProfileId(provider.providerId, method.id);
    const existingProfile = existingByProfileId.get(profileId);

    if (existingProfile) {
        const action = await p.select({
            message: `A ${method.label} connection already exists for ${provider.label}.`,
            options: [
                {
                    value: 'use_existing',
                    label:
                        defaultProfileIdForProvider === profileId
                            ? 'Keep as default'
                            : 'Use existing (set default)',
                    hint:
                        defaultProfileIdForProvider === profileId
                            ? 'No changes'
                            : 'No re-auth required',
                },
                {
                    value: 'replace',
                    label: 'Replace credentials',
                    hint: 'Requires re-auth / re-entering secrets',
                },
                {
                    value: 'delete',
                    label: 'Delete credentials',
                    hint:
                        defaultProfileIdForProvider === profileId
                            ? 'Removes slot and clears default'
                            : 'Removes slot',
                },
            ],
        });

        if (isCancel(action)) {
            p.cancel('Connect cancelled');
            return;
        }

        if (action === 'use_existing') {
            await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });
            p.outro(chalk.green(`✅ Set default ${provider.label} auth to ${method.label}`));
            return;
        }

        if (action === 'delete') {
            const confirmed = await p.confirm({
                message: `Delete saved ${method.label} credentials for ${provider.label}?`,
                initialValue: false,
            });

            if (p.isCancel(confirmed) || !confirmed) {
                p.cancel('Connect cancelled');
                return;
            }

            await deleteLlmAuthProfile(profileId);
            p.outro(chalk.green(`✅ Deleted ${provider.label} credentials for ${method.label}`));
            return;
        }
    }

    if (method.kind === 'api_key') {
        const apiKey = await p.password({
            message: `Enter ${provider.label} API key`,
            validate: (value) => {
                if (!value?.trim()) return 'API key is required';
                if (value.trim().length < 10) return 'API key looks unusually short';
                return undefined;
            },
        });
        if (isCancel(apiKey)) {
            p.cancel('Connect cancelled');
            return;
        }

        await persistConnectedProfile({
            profileId,
            credential: { type: 'api_key', key: String(apiKey).trim() },
            provider,
            method,
        });
        await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

        p.outro(chalk.green(`✅ Connected ${provider.label} (API key saved)`));
        return;
    }

    if (method.kind === 'token') {
        const token = await p.password({
            message: `Enter ${provider.label} token`,
            validate: (value) => {
                if (!value?.trim()) return 'Token is required';
                if (value.trim().length < 10) return 'Token looks unusually short';
                return undefined;
            },
        });
        if (isCancel(token)) {
            p.cancel('Connect cancelled');
            return;
        }

        await persistConnectedProfile({
            profileId,
            credential: { type: 'token', token: String(token).trim() },
            provider,
            method,
        });
        await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

        p.outro(chalk.green(`✅ Connected ${provider.label} (token saved)`));
        return;
    }

    if (method.kind === 'external_account') {
        let credential: LlmAuthCredential | null;
        try {
            credential = await connectExternalAccount({ provider, method });
        } catch (error) {
            const message = getCodexLoginErrorMessage(error);
            p.outro(chalk.red(`❌ ${provider.label} login failed: ${message}`));
            return;
        }

        if (!credential) {
            p.cancel('Connect cancelled');
            return;
        }

        await persistConnectedProfile({
            profileId,
            credential,
            provider,
            method,
        });
        await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

        p.outro(chalk.green(`✅ Connected ${provider.label} (${method.label})`));
        return;
    }

    if (method.kind === 'oauth') {
        const spinner = p.spinner();
        spinner.start(`Starting ${provider.label} OAuth…`);

        let flow: Awaited<ReturnType<typeof method.oauth.start>>;
        try {
            flow = await method.oauth.start({
                userAgent: `dexto/${process.env.DEXTO_CLI_VERSION || 'dev'}`,
            });
        } catch (error) {
            spinner.stop('Failed');
            const message = error instanceof Error ? error.message : String(error);
            p.outro(chalk.red(`❌ ${provider.label} OAuth failed: ${message}`));
            return;
        }

        spinner.stop(`Open ${flow.verificationUrl} and enter code: ${flow.userCode}`);

        try {
            await open(flow.verificationUrl);
        } catch {
            // ignore - user can open manually
        }

        const pollSpinner = p.spinner();
        pollSpinner.start('Waiting for approval…');

        let result: Awaited<ReturnType<typeof flow.waitForCompletion>>;
        try {
            result = await flow.waitForCompletion({
                onProgress: (message: string) => pollSpinner.message(message),
            });
            pollSpinner.stop('Approved');
        } catch (error) {
            pollSpinner.stop('Failed');
            const message = error instanceof Error ? error.message : String(error);
            p.outro(chalk.red(`❌ ${provider.label} OAuth failed: ${message}`));
            return;
        }

        await persistConnectedProfile({
            profileId,
            credential: result.credential,
            provider,
            method,
        });
        await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

        if (result.notificationMessage) {
            console.log(chalk.dim(result.notificationMessage));
        }

        p.outro(chalk.green(`✅ Connected ${provider.label} (${method.label})`));
        return;
    }

    if (method.kind === 'guidance') {
        console.log('');
        console.log(chalk.cyan(`Guided setup for ${provider.label}`));

        if (provider.modelsDevProviderId) {
            console.log(
                chalk.dim(
                    `Tip: See provider docs for ${provider.modelsDevProviderId} on models.dev and the upstream provider site.`
                )
            );
        }

        const shouldOpenDocs = await p.confirm({
            message: 'Open provider documentation in your browser?',
            initialValue: true,
        });

        if (!p.isCancel(shouldOpenDocs) && shouldOpenDocs) {
            if (provider.modelsDevProviderId) {
                // Best-effort: open models.dev provider page (if available); user can navigate from there.
                await open(`https://models.dev/${provider.modelsDevProviderId}`);
            }
        }

        p.outro(chalk.green('✅ Guided setup complete'));
        return;
    }

    p.outro(chalk.red('❌ Unsupported connect method'));
}
