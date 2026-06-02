import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Box, Text } from 'ink';
import open from 'open';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import {
    deleteModelAuthProfile,
    getDefaultModelAuthProfileIdForProvider,
    getModelAuthProfileId,
    getProviderAuthDefinitions,
    listSavedModelAuthProfiles,
    markModelAuthProviderConnected,
    saveApiKeyModelAuthProfile,
    saveProviderApiKey,
    setDefaultModelAuthProfile,
    startModelAuthBrowserLogin,
    type AuthMethodDefinition,
    type ModelAuthProfile,
    type ProviderAuthDefinition,
} from '@dexto/agent-management';
import { LLM_PROVIDERS, type LLMProvider } from '@dexto/llm';
import { applyLayeredEnvironmentLoading, isValidApiKeyFormat } from '../../host/index.js';

type ConnectStep =
    | 'provider'
    | 'method'
    | 'existing-action'
    | 'delete-confirm'
    | 'api-key'
    | 'oauth-progress'
    | 'error';

type ConnectOption = {
    value: string;
    label: string;
    hint?: string | undefined;
};

export type ConnectOverlayOutcome =
    | { outcome: 'success'; providerId: string; message: string }
    | { outcome: 'cancelled' }
    | { outcome: 'closed' };

export interface ConnectOverlayProps {
    isVisible: boolean;
    onDone: (outcome: ConnectOverlayOutcome) => void;
}

export interface ConnectOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
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

function maskSecret(secret: string): string {
    if (secret.length <= 8) {
        return '*'.repeat(secret.length);
    }
    return `${secret.slice(0, 4)}${'*'.repeat(Math.min(secret.length - 8, 24))}${secret.slice(-4)}`;
}

function toLlmProvider(providerId: string): LLMProvider {
    const provider = LLM_PROVIDERS.find((candidate) => candidate === providerId);
    if (!provider) {
        throw new Error(`API-key auth is not implemented for provider: ${providerId}`);
    }
    return provider;
}

const ConnectOverlay = forwardRef<ConnectOverlayHandle, ConnectOverlayProps>(
    function ConnectOverlay({ isVisible, onDone }, ref) {
        const selectorRef = useRef<BaseSelectorHandle>(null);
        const loginCancelRef = useRef<(() => Promise<void>) | null>(null);
        const [step, setStep] = useState<ConnectStep>('provider');
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [provider, setProvider] = useState<ProviderAuthDefinition | null>(null);
        const [method, setMethod] = useState<AuthMethodDefinition | null>(null);
        const [profiles, setProfiles] = useState<ModelAuthProfile[]>([]);
        const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
        const [apiKey, setApiKey] = useState('');
        const [status, setStatus] = useState('Choose a provider to connect.');
        const [error, setError] = useState<string | null>(null);

        const currentProfileId =
            provider && method ? getModelAuthProfileId(provider.providerId, method.id) : null;
        const existingProfile = currentProfileId
            ? (profiles.find((profile) => profile.id === currentProfileId) ?? null)
            : null;

        const close = useCallback(
            (outcome: ConnectOverlayOutcome) => {
                void loginCancelRef.current?.();
                loginCancelRef.current = null;
                onDone(outcome);
            },
            [onDone]
        );
        const handleActionError = useCallback((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
            setStep('error');
        }, []);

        useEffect(() => {
            if (!isVisible) {
                return;
            }

            setStep('provider');
            setSelectedIndex(0);
            setProvider(null);
            setMethod(null);
            setProfiles([]);
            setDefaultProfileId(null);
            setApiKey('');
            setStatus('Choose a provider to connect.');
            setError(null);
        }, [isVisible]);

        const providerOptions = useMemo<ConnectOption[]>(
            () =>
                getProviderAuthDefinitions().map((item) => ({
                    value: item.providerId,
                    label: item.label,
                    hint: `${item.methods.length} method${item.methods.length === 1 ? '' : 's'}`,
                })),
            []
        );

        const methodOptions = useMemo<ConnectOption[]>(() => {
            if (!provider) {
                return [];
            }

            return provider.methods.map((item) => {
                const profile = profiles.find(
                    (candidate) =>
                        candidate.id === getModelAuthProfileId(provider.providerId, item.id)
                );
                return {
                    value: item.id,
                    label: item.label,
                    hint: methodHint(item, profile, defaultProfileId),
                };
            });
        }, [defaultProfileId, profiles, provider]);

        const existingActionOptions = useMemo<ConnectOption[]>(() => {
            if (!existingProfile) {
                return [];
            }

            return [
                {
                    value: 'use',
                    label:
                        existingProfile.id === defaultProfileId
                            ? 'Keep as default'
                            : 'Use existing',
                    hint:
                        existingProfile.id === defaultProfileId
                            ? 'No changes'
                            : 'Set this method as provider default',
                },
                { value: 'replace', label: 'Replace credentials', hint: 'Reconnect this method' },
                {
                    value: 'delete',
                    label: 'Delete credentials',
                    ...(existingProfile.id === defaultProfileId
                        ? { hint: 'Also clears default' }
                        : {}),
                },
            ];
        }, [defaultProfileId, existingProfile]);

        const activeItems =
            step === 'provider'
                ? providerOptions
                : step === 'method'
                  ? methodOptions
                  : step === 'existing-action'
                    ? existingActionOptions
                    : [];

        const loadProvider = useCallback(async (nextProvider: ProviderAuthDefinition) => {
            setProvider(nextProvider);
            setMethod(null);
            setStatus(`Loading saved ${nextProvider.label} profiles...`);
            const [savedProfiles, savedDefaultProfileId] = await Promise.all([
                listSavedModelAuthProfiles(nextProvider.providerId),
                getDefaultModelAuthProfileIdForProvider(nextProvider.providerId),
            ]);
            setProfiles(savedProfiles);
            setDefaultProfileId(savedDefaultProfileId);
            setSelectedIndex(0);
            setStatus(`Choose how to connect ${nextProvider.label}.`);
            setStep('method');
        }, []);

        const saveApiKey = useCallback(async () => {
            if (!provider || !method) {
                close({ outcome: 'cancelled' });
                return;
            }

            const trimmed = apiKey.trim();
            if (!trimmed) {
                setError('API key is required');
                return;
            }

            const llmProvider = toLlmProvider(provider.providerId);
            if (!isValidApiKeyFormat(trimmed, llmProvider)) {
                setError(`${provider.label} API key format is invalid`);
                return;
            }

            setError(null);
            try {
                setStatus(`Saving ${provider.label} API key...`);
                await saveProviderApiKey(llmProvider, trimmed, process.cwd());
                await applyLayeredEnvironmentLoading();
                await saveApiKeyModelAuthProfile(llmProvider);
                await markModelAuthProviderConnected(provider.providerId);
                close({
                    outcome: 'success',
                    providerId: provider.providerId,
                    message: `Connected ${provider.label} (${method.label})`,
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }, [apiKey, close, method, provider]);

        const connectOAuth = useCallback(
            async (nextProvider: ProviderAuthDefinition, nextMethod: AuthMethodDefinition) => {
                setStep('oauth-progress');
                setStatus(`Starting ${nextMethod.label}...`);
                let timeout: NodeJS.Timeout | null = null;
                try {
                    const login = await startModelAuthBrowserLogin({
                        providerId: nextProvider.providerId,
                        methodId: nextMethod.id,
                    });
                    loginCancelRef.current = login.cancel;
                    setStatus(`Opening browser for ${nextMethod.label}...`);
                    await open(login.authUrl).catch(() => undefined);
                    setStatus('Waiting for browser authorization...');
                    await Promise.race([
                        login.waitForProfile(),
                        new Promise<never>((_, reject) => {
                            timeout = setTimeout(
                                () => reject(new Error(`${nextMethod.label} timed out`)),
                                5 * 60 * 1000
                            );
                        }),
                    ]);
                    await markModelAuthProviderConnected(nextProvider.providerId);
                    close({
                        outcome: 'success',
                        providerId: nextProvider.providerId,
                        message: `Connected ${nextProvider.label} (${nextMethod.label})`,
                    });
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                    setStep('error');
                } finally {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    await loginCancelRef.current?.();
                    loginCancelRef.current = null;
                }
            },
            [close]
        );

        const startConnect = useCallback(async () => {
            if (!provider || !method) {
                close({ outcome: 'cancelled' });
                return;
            }

            if (method.kind === 'api_key') {
                setApiKey('');
                setError(null);
                setStatus(`Enter your ${provider.label} API key.`);
                setStep('api-key');
                return;
            }

            if (method.kind === 'oauth') {
                await connectOAuth(provider, method);
            }
        }, [close, connectOAuth, method, provider]);

        const handleSelect = useCallback(
            async (option: ConnectOption) => {
                if (step === 'provider') {
                    const nextProvider = getProviderAuthDefinitions().find(
                        (candidate) => candidate.providerId === option.value
                    );
                    if (nextProvider) {
                        await loadProvider(nextProvider);
                    }
                    return;
                }

                if (step === 'method' && provider) {
                    const nextMethod = provider.methods.find(
                        (candidate) => candidate.id === option.value
                    );
                    if (nextMethod) {
                        setMethod(nextMethod);
                        const profileId = getModelAuthProfileId(provider.providerId, nextMethod.id);
                        if (profiles.some((item) => item.id === profileId)) {
                            setStatus(`Manage ${provider.label} ${nextMethod.label}.`);
                            setStep('existing-action');
                            setSelectedIndex(0);
                            return;
                        }
                        if (nextMethod.kind === 'api_key') {
                            setApiKey('');
                            setError(null);
                            setStatus(`Enter your ${provider.label} API key.`);
                            setStep('api-key');
                            return;
                        }
                        if (nextMethod.kind === 'oauth') {
                            await connectOAuth(provider, nextMethod);
                        }
                    }
                    return;
                }

                if (step === 'existing-action' && provider && method && currentProfileId) {
                    if (option.value === 'use') {
                        await setDefaultModelAuthProfile({
                            providerId: provider.providerId,
                            profileId: currentProfileId,
                        });
                        close({
                            outcome: 'success',
                            providerId: provider.providerId,
                            message: `Using ${provider.label} ${method.label}`,
                        });
                        return;
                    }

                    if (option.value === 'replace') {
                        await startConnect();
                        return;
                    }

                    if (option.value === 'delete') {
                        setStatus(`Press Enter to delete ${provider.label} ${method.label}.`);
                        setStep('delete-confirm');
                    }
                }
            },
            [
                close,
                connectOAuth,
                currentProfileId,
                loadProvider,
                method,
                profiles,
                provider,
                startConnect,
                step,
            ]
        );

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    if (step === 'api-key') {
                        if (key.escape) {
                            close({ outcome: 'cancelled' });
                            return true;
                        }
                        if (key.return) {
                            void saveApiKey().catch(handleActionError);
                            return true;
                        }
                        if (key.backspace || key.delete) {
                            setApiKey((prev) => prev.slice(0, -1));
                            setError(null);
                            return true;
                        }
                        if (input && !key.ctrl && !key.meta) {
                            setApiKey((prev) => prev + input);
                            setError(null);
                            return true;
                        }
                        return true;
                    }

                    if (step === 'delete-confirm') {
                        if (key.escape) {
                            close({ outcome: 'cancelled' });
                            return true;
                        }
                        if (key.return && provider && method && currentProfileId) {
                            void deleteModelAuthProfile(currentProfileId)
                                .then(() =>
                                    close({
                                        outcome: 'success',
                                        providerId: provider.providerId,
                                        message: `Deleted ${provider.label} ${method.label}`,
                                    })
                                )
                                .catch(handleActionError);
                            return true;
                        }
                        return true;
                    }

                    if (step === 'oauth-progress') {
                        if (key.escape) {
                            close({ outcome: 'cancelled' });
                        }
                        return true;
                    }

                    if (step === 'error') {
                        if (key.escape || key.return) {
                            close({ outcome: 'closed' });
                        }
                        return true;
                    }

                    return selectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            [
                close,
                currentProfileId,
                handleActionError,
                isVisible,
                method,
                provider,
                saveApiKey,
                step,
            ]
        );

        if (!isVisible) return null;

        return (
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Connect Model Provider
                    </Text>
                </Box>
                <Text color={error ? 'red' : 'gray'}>{error ?? status}</Text>
                {step === 'api-key' ? (
                    <Box flexDirection="column" marginTop={1}>
                        <Text>{maskSecret(apiKey)}</Text>
                        <Text color="gray">Enter save • Esc cancel</Text>
                    </Box>
                ) : step === 'delete-confirm' ? (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color="red">This removes saved credentials for this method.</Text>
                        <Text color="gray">Enter delete • Esc cancel</Text>
                    </Box>
                ) : step === 'oauth-progress' ? (
                    <Box marginTop={1}>
                        <Text color="gray">Esc cancel</Text>
                    </Box>
                ) : step === 'error' ? (
                    <Box marginTop={1}>
                        <Text color="gray">Enter close • Esc close</Text>
                    </Box>
                ) : (
                    <Box marginTop={1}>
                        <BaseSelector
                            ref={selectorRef}
                            items={activeItems}
                            isVisible={true}
                            selectedIndex={selectedIndex}
                            onSelectIndex={setSelectedIndex}
                            onSelect={(item) => void handleSelect(item).catch(handleActionError)}
                            onClose={() => close({ outcome: 'cancelled' })}
                            title={
                                step === 'provider'
                                    ? 'Providers'
                                    : step === 'method'
                                      ? `${provider?.label ?? 'Provider'} methods`
                                      : 'Existing profile'
                            }
                            formatItem={(item, selected) => (
                                <Text {...(selected ? { color: 'cyan' } : {})}>
                                    {selected ? '› ' : '  '}
                                    {item.label}
                                    {item.hint ? <Text color="gray"> — {item.hint}</Text> : null}
                                </Text>
                            )}
                        />
                    </Box>
                )}
            </Box>
        );
    }
);

export default ConnectOverlay;
