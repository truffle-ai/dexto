import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';

import {
    CONNECT_PROVIDERS,
    getConnectProvider,
    deleteLlmAuthProfile,
    getDefaultLlmAuthProfileId,
    listLlmAuthProfiles,
    setDefaultLlmAuthProfile,
    upsertLlmAuthProfile,
} from '@dexto/agent-management';

import { extractChatGptAccountId, loginOpenAiCodexDeviceCode } from './openai-codex.js';
import { loginMiniMaxPortalDeviceCode, type MiniMaxRegion } from './minimax-portal.js';

function isCancel<T>(value: T | symbol): value is symbol {
    return p.isCancel(value);
}

function toProviderOption(provider: (typeof CONNECT_PROVIDERS)[number]): p.Option<string> {
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

export async function handleConnectCommand(options?: { interactive?: boolean }): Promise<void> {
    if (options?.interactive === false) {
        throw new Error('Non-interactive connect is not implemented yet');
    }

    p.intro(chalk.inverse(' Connect Provider '));

    const providerId = await p.select({
        message: 'Choose a provider',
        options: CONNECT_PROVIDERS.map(toProviderOption),
    });

    if (isCancel(providerId)) {
        p.cancel('Connect cancelled');
        return;
    }

    const provider = getConnectProvider(providerId as string);
    if (!provider) {
        p.cancel(`Unknown provider: ${providerId as string}`);
        return;
    }

    const existingProfiles = await listLlmAuthProfiles({ providerId: provider.providerId });
    const existingByProfileId = new Map(existingProfiles.map((p) => [p.profileId, p]));
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

    const method = provider.methods.find((m) => m.id === methodId);
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

        await upsertLlmAuthProfile({
            profileId,
            providerId: provider.providerId,
            methodId: method.id,
            label: method.label,
            credential: { type: 'api_key', key: String(apiKey).trim() },
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

        await upsertLlmAuthProfile({
            profileId,
            providerId: provider.providerId,
            methodId: method.id,
            label: method.label,
            credential: { type: 'token', token: String(token).trim() },
        });
        await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

        p.outro(chalk.green(`✅ Connected ${provider.label} (token saved)`));
        return;
    }

    if (method.kind === 'oauth') {
        if (provider.providerId === 'openai' && method.id === 'oauth_codex') {
            const clientId = process.env.DEXTO_OPENAI_CODEX_OAUTH_CLIENT_ID?.trim();
            if (!clientId) {
                p.outro(
                    chalk.red(
                        '❌ Missing DEXTO_OPENAI_CODEX_OAUTH_CLIENT_ID (OAuth app client id required)'
                    )
                );
                return;
            }

            const spinner = p.spinner();
            spinner.start('Starting OpenAI OAuth (device code)…');

            const userAgent = `dexto/${process.env.DEXTO_CLI_VERSION || 'dev'}`;
            const flow = await loginOpenAiCodexDeviceCode({ clientId, userAgent });
            spinner.stop(`Open ${flow.deviceUrl} and enter code: ${flow.userCode}`);

            try {
                await open(flow.deviceUrl);
            } catch {
                // ignore - user can open manually
            }

            const pollSpinner = p.spinner();
            pollSpinner.start('Waiting for approval…');
            let tokens: Awaited<ReturnType<typeof flow.callback>>;
            try {
                tokens = await flow.callback();
                pollSpinner.stop('Approved');
            } catch (error) {
                pollSpinner.stop('Failed');
                const message = error instanceof Error ? error.message : String(error);
                console.log('');
                console.log(
                    chalk.yellow(
                        'Note: OpenAI ChatGPT OAuth (Codex) may require allowlisting for our OAuth app.'
                    )
                );
                console.log(chalk.dim('If this fails, use the OpenAI API key method instead.'));
                p.outro(chalk.red(`❌ OpenAI OAuth failed: ${message}`));
                return;
            }

            const accountId = extractChatGptAccountId(tokens);
            const expiresAt = Date.now() + tokens.expiresInSec * 1000;

            await upsertLlmAuthProfile({
                profileId,
                providerId: provider.providerId,
                methodId: method.id,
                label: method.label,
                credential: {
                    type: 'oauth',
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt,
                    metadata: {
                        clientId,
                        ...(accountId ? { accountId } : {}),
                    },
                },
            });
            await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

            p.outro(chalk.green('✅ Connected OpenAI (ChatGPT OAuth)'));
            return;
        }

        if (provider.providerId.startsWith('minimax')) {
            const clientId = process.env.DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID?.trim();
            if (!clientId) {
                p.outro(
                    chalk.red(
                        '❌ Missing DEXTO_MINIMAX_PORTAL_OAUTH_CLIENT_ID (OAuth app client id required)'
                    )
                );
                return;
            }

            const region: MiniMaxRegion =
                method.id === 'portal_oauth_cn' || provider.providerId.includes('-cn')
                    ? 'cn'
                    : ('global' satisfies MiniMaxRegion);
            const spinner = p.spinner();
            spinner.start(`Starting MiniMax OAuth (${region})…`);

            const flow = await loginMiniMaxPortalDeviceCode({ region, clientId });
            spinner.stop(`Open ${flow.verificationUrl} and enter code: ${flow.userCode}`);

            try {
                await open(flow.verificationUrl);
            } catch {
                // ignore - user can open manually
            }

            const pollSpinner = p.spinner();
            pollSpinner.start('Waiting for approval…');
            let tokens: Awaited<ReturnType<typeof flow.callback>>;
            try {
                tokens = await flow.callback((message) => pollSpinner.message(message));
                pollSpinner.stop('Approved');
            } catch (error) {
                pollSpinner.stop('Failed');
                const message = error instanceof Error ? error.message : String(error);
                p.outro(chalk.red(`❌ MiniMax OAuth failed: ${message}`));
                return;
            }

            await upsertLlmAuthProfile({
                profileId,
                providerId: provider.providerId,
                methodId: method.id,
                label: method.label,
                credential: {
                    type: 'oauth',
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: tokens.expiresAt,
                    metadata: {
                        region,
                        clientId,
                        ...(tokens.resourceUrl ? { resourceUrl: tokens.resourceUrl } : {}),
                    },
                },
            });
            await setDefaultLlmAuthProfile({ providerId: provider.providerId, profileId });

            if (tokens.notificationMessage) {
                console.log(chalk.dim(tokens.notificationMessage));
            }

            p.outro(chalk.green('✅ Connected MiniMax (OAuth)'));
            return;
        }

        p.outro(chalk.red(`❌ OAuth method not implemented for ${provider.label}`));
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
