import chalk from 'chalk';
import * as p from '@clack/prompts';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import { safeExit, ExitSignal } from '../../analytics/wrapper.js';
import { hasUsableCredentials } from '../../config/cli-overrides.js';
import type { MainModeContext } from './context.js';
import { applyWorkspaceToAgent } from '../../utils/workspace.js';

async function getMostRecentSessionId(agent: DextoAgent): Promise<string | null> {
    const sessionIds = await agent.listSessions();
    if (sessionIds.length === 0) {
        return null;
    }

    let mostRecentId: string | null = null;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
        const metadata = await agent.getSessionMetadata(sessionId);
        if (metadata && metadata.lastActivity > mostRecentActivity) {
            mostRecentActivity = metadata.lastActivity;
            mostRecentId = sessionId;
        }
    }

    return mostRecentId;
}

export async function runCliMode(context: MainModeContext): Promise<void> {
    const {
        agent,
        opts,
        workspaceRoot,
        validatedConfig,
        resolvedPath,
        initialPrompt,
        getVersionCheckResult,
    } = context;

    const needsHandler =
        validatedConfig.permissions.mode === 'manual' || validatedConfig.elicitation.enabled;

    if (needsHandler) {
        const { createCLIApprovalHandler } = await import('../approval/index.js');
        const handler = createCLIApprovalHandler(agent);
        agent.setApprovalHandler(handler);

        logger.debug('CLI approval handler configured for Ink CLI');
    }

    try {
        await agent.start();
        await applyWorkspaceToAgent(agent, workspaceRoot);
        const llmConfig = agent.getCurrentLLMConfig();
        if (!hasUsableCredentials(llmConfig.provider, llmConfig)) {
            const { globalPreferencesExist, loadGlobalPreferences } = await import(
                '@dexto/agent-management'
            );
            const { interactiveApiKeySetup } = await import('../utils/api-key-setup.js');
            const { getProviderDisplayName, getProviderEnvVar } = await import(
                '../utils/provider-setup.js'
            );

            let hasCompletedSetup = false;
            if (globalPreferencesExist()) {
                try {
                    const preferences = await loadGlobalPreferences();
                    hasCompletedSetup = preferences.setup.completed;
                } catch {
                    hasCompletedSetup = false;
                }
            }

            console.log(
                chalk.yellow(
                    `\n⚠️  API key required for provider '${getProviderDisplayName(llmConfig.provider)}'\n`
                )
            );

            if (!hasCompletedSetup) {
                console.log(
                    chalk.gray(
                        `Dexto started with the bundled coding-agent defaults. ` +
                            `Set ${getProviderEnvVar(llmConfig.provider)} or run ${chalk.cyan(
                                'dexto setup'
                            )} to choose a different provider.`
                    )
                );
            }

            const runProviderKeySetup = async () => {
                const setupResult = await interactiveApiKeySetup(llmConfig.provider, {
                    exitOnCancel: false,
                    model: llmConfig.model,
                });

                if (setupResult.cancelled) {
                    safeExit('main', 0, 'api-key-setup-cancelled');
                }

                if (setupResult.skipped) {
                    safeExit('main', 0, 'api-key-pending');
                }

                if (setupResult.success && setupResult.apiKey) {
                    await agent.switchLLM({
                        provider: llmConfig.provider,
                        model: llmConfig.model,
                        apiKey: setupResult.apiKey,
                    });
                    logger.info('API key configured successfully, continuing...');
                }
            };

            if (hasCompletedSetup) {
                await runProviderKeySetup();
            } else {
                const action = await p.select({
                    message: 'How would you like to continue?',
                    options: [
                        {
                            value: 'key',
                            label: `Paste a ${getProviderDisplayName(llmConfig.provider)} key`,
                            hint: 'Continue in this session',
                        },
                        {
                            value: 'setup',
                            label: 'Run dexto setup',
                            hint: 'Choose a different provider or save defaults',
                        },
                        {
                            value: 'exit',
                            label: 'Exit',
                            hint: 'Configure later',
                        },
                    ],
                });

                if (p.isCancel(action) || action === 'exit') {
                    safeExit('main', 0, 'api-key-setup-cancelled');
                }

                if (action === 'setup') {
                    const { handleSetupCommand } = await import('../commands/setup.js');
                    await handleSetupCommand({ interactive: true, force: true });

                    let preferences;
                    try {
                        preferences = await loadGlobalPreferences();
                    } catch {
                        safeExit('main', 0, 'setup-incomplete');
                    }

                    if (!preferences.setup.completed) {
                        safeExit('main', 0, 'setup-incomplete');
                    }
                    if (preferences.setup.apiKeyPending) {
                        safeExit('main', 0, 'api-key-pending');
                    }
                    await agent.switchLLM({
                        provider: preferences.llm.provider,
                        model: preferences.llm.model,
                        ...(preferences.llm.apiKey && { apiKey: preferences.llm.apiKey }),
                        ...(preferences.llm.baseURL && { baseURL: preferences.llm.baseURL }),
                    });
                    logger.info('Provider configured successfully, continuing...');
                } else {
                    await runProviderKeySetup();
                }
            }
        }

        let cliSessionId: string;
        if (opts.resume) {
            const existing = await agent.getSession(opts.resume);
            if (!existing) {
                console.error(`❌ Session '${opts.resume}' not found`);
                console.error('💡 Use `dexto session list` to see available sessions');
                safeExit('main', 1, 'resume-failed');
            }
            cliSessionId = opts.resume;
        } else if (opts.continue) {
            const mostRecentSessionId = await getMostRecentSessionId(agent);
            if (mostRecentSessionId) {
                cliSessionId = mostRecentSessionId;
            } else {
                const session = await agent.createSession();
                cliSessionId = session.id;
            }
        } else {
            const session = await agent.createSession();
            cliSessionId = session.id;
        }

        const cliUpdateInfo = await getVersionCheckResult();

        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
        };
        const noOp = () => {};
        console.log = noOp;
        console.error = noOp;
        console.warn = noOp;
        console.info = noOp;

        let inkError: unknown = undefined;
        try {
            const [
                { startInkCliRefactored, setTuiRuntimeServices },
                { registerGracefulShutdown },
                { applyLayeredEnvironmentLoading },
                { getProviderDisplayName, isValidApiKeyFormat, getProviderInstructions },
                {
                    performDeviceCodeLogin,
                    persistOAuthLoginResult,
                    ensureDextoApiKeyForAuthToken,
                    loadAuth,
                    storeAuth,
                    removeAuth,
                    removeDextoApiKeyFromEnv,
                    buildDextoBillingUrl,
                    openDextoBillingPage,
                },
                { isUsingDextoCredits },
                { canUseDextoProvider },
                { capture },
            ] = await Promise.all([
                import('@dexto/tui'),
                import('../../utils/graceful-shutdown.js'),
                import('../../utils/env.js'),
                import('../utils/provider-setup.js'),
                import('../auth/index.js'),
                import('../../config/effective-llm.js'),
                import('../utils/dexto-setup.js'),
                import('../../analytics/index.js'),
            ]);

            setTuiRuntimeServices({
                registerGracefulShutdown,
                capture: (event, properties) => {
                    capture(event as never, properties as never);
                },
                applyLayeredEnvironmentLoading,
                getProviderDisplayName,
                isValidApiKeyFormat,
                getProviderInstructions,
                performDeviceCodeLogin,
                persistOAuthLoginResult,
                ensureDextoApiKeyForAuthToken,
                loadAuth,
                storeAuth,
                removeAuth,
                removeDextoApiKeyFromEnv,
                isUsingDextoCredits,
                canUseDextoProvider,
                buildDextoBillingUrl,
                openDextoBillingPage,
            });

            await startInkCliRefactored(agent, cliSessionId, {
                updateInfo: cliUpdateInfo ?? undefined,
                configFilePath: resolvedPath,
                ...(initialPrompt && { initialPrompt }),
                bypassPermissions: opts.bypassPermissions,
            });
        } catch (error) {
            inkError = error;
        } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            console.info = originalConsole.info;
        }

        if (inkError) {
            if (inkError instanceof ExitSignal) throw inkError;
            const errorMessage = inkError instanceof Error ? inkError.message : String(inkError);
            console.error(`❌ Ink CLI failed: ${errorMessage}`);
            if (inkError instanceof Error && inkError.stack) {
                console.error(inkError.stack);
            }
            safeExit('main', 1, 'ink-cli-error');
        }

        safeExit('main', 0);
    } finally {
        try {
            await agent.stop();
        } catch {
            // Ignore shutdown errors
        }
    }
}
