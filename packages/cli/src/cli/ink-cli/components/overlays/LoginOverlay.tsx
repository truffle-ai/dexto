import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    type DextoApiKeyProvisionStatus,
    beginOAuthLogin,
    DEFAULT_OAUTH_CONFIG,
    type DeviceLoginPrompt,
    loadAuth,
    type OAuthResult,
    performDeviceCodeLogin,
    persistOAuthLoginResult,
    shouldAttemptBrowserLaunch,
} from '../../../auth/index.js';

export type LoginOverlayOutcome =
    | {
          outcome: 'success';
          email?: string | undefined;
          keyId?: string | undefined;
          hasDextoApiKey: boolean;
      }
    | { outcome: 'cancelled' }
    | { outcome: 'closed' };

export interface LoginOverlayProps {
    isVisible: boolean;
    onDone: (outcome: LoginOverlayOutcome) => void;
}

export interface LoginOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type LoginStep =
    | 'checking'
    | 'already-authenticated'
    | 'starting'
    | 'opening-browser'
    | 'waiting'
    | 'finalizing'
    | 'error';

function isCancellationError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return lower.includes('cancel') || lower.includes('denied');
}

const LoginOverlay = forwardRef<LoginOverlayHandle, LoginOverlayProps>(function LoginOverlay(
    { isVisible, onDone },
    ref
) {
    const [step, setStep] = useState<LoginStep>('checking');
    const [existingUser, setExistingUser] = useState<string | null>(null);
    const [authUrl, setAuthUrl] = useState<string | null>(null);
    const [devicePrompt, setDevicePrompt] = useState<DeviceLoginPrompt | null>(null);
    const [status, setStatus] = useState<string>('Preparing login...');
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isActiveRef = useRef(false);

    const safeSetStatus = useCallback((message: string) => {
        if (!isActiveRef.current) return;
        setStatus(message);
    }, []);

    const handleProvisionStatus = useCallback(
        (provisionStatus: DextoApiKeyProvisionStatus) => {
            safeSetStatus(provisionStatus.message);
        },
        [safeSetStatus]
    );

    const cancelInFlight = useCallback(() => {
        abortControllerRef.current?.abort(new Error('Authentication cancelled'));
        abortControllerRef.current = null;
    }, []);

    const runBrowserLogin = useCallback(
        async (abortController: AbortController): Promise<OAuthResult | null> => {
            setStep('starting');
            safeSetStatus('Starting local callback server...');

            const session = await beginOAuthLogin(DEFAULT_OAUTH_CONFIG, {
                signal: abortController.signal,
            });

            if (!isActiveRef.current || abortController.signal.aborted) {
                void session.result.catch(() => undefined);
                session.cancel();
                return null;
            }

            setAuthUrl(session.authUrl);
            setDevicePrompt(null);
            setStep('opening-browser');
            safeSetStatus('Opening browser for authentication...');

            let browserOpened = false;
            try {
                const { default: open } = await import('open');
                await open(session.authUrl);
                browserOpened = true;
            } catch {
                // Fall through to device flow fallback
            }

            if (!isActiveRef.current || abortController.signal.aborted) {
                void session.result.catch(() => undefined);
                session.cancel();
                return null;
            }

            if (!browserOpened) {
                void session.result.catch(() => undefined);
                session.cancel();
                throw new Error('Automatic browser launch unavailable');
            }

            setStep('waiting');
            safeSetStatus('Waiting for authentication...');
            return session.result;
        },
        [safeSetStatus]
    );

    const runDeviceLogin = useCallback(
        async (abortController: AbortController): Promise<OAuthResult> => {
            setStep('starting');
            safeSetStatus('Starting device code login...');
            setAuthUrl(null);
            setDevicePrompt(null);

            return performDeviceCodeLogin({
                signal: abortController.signal,
                onPrompt: (prompt) => {
                    if (!isActiveRef.current || abortController.signal.aborted) {
                        return;
                    }
                    setDevicePrompt(prompt);
                    setAuthUrl(prompt.verificationUrlComplete ?? prompt.verificationUrl);
                    setStep('waiting');
                    safeSetStatus('Open the URL below and approve login.');
                },
            });
        },
        [safeSetStatus]
    );

    const startLogin = useCallback(async () => {
        cancelInFlight();
        setError(null);
        setAuthUrl(null);
        setDevicePrompt(null);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const browserLikelyUsable = shouldAttemptBrowserLaunch();
            let result: OAuthResult | null = null;

            if (browserLikelyUsable) {
                try {
                    result = await runBrowserLogin(abortController);
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    if (isCancellationError(errorMessage)) {
                        throw err;
                    }

                    safeSetStatus('Browser callback unavailable. Switching to device code...');
                    result = await runDeviceLogin(abortController);
                }
            } else {
                safeSetStatus('Detected headless/remote environment. Using device code login...');
                result = await runDeviceLogin(abortController);
            }

            if (!result || !isActiveRef.current || abortController.signal.aborted) return;

            setStep('finalizing');
            safeSetStatus('Finalizing login...');

            const persisted = await persistOAuthLoginResult(result, {
                onProvisionStatus: handleProvisionStatus,
            });

            if (!isActiveRef.current || abortController.signal.aborted) return;
            onDone({
                outcome: 'success',
                email: persisted.email,
                keyId: persisted.keyId,
                hasDextoApiKey: persisted.hasDextoApiKey,
            });
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }

            setStep('error');
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            safeSetStatus('Login failed');
        } finally {
            abortControllerRef.current = null;
        }
    }, [
        cancelInFlight,
        handleProvisionStatus,
        onDone,
        runBrowserLogin,
        runDeviceLogin,
        safeSetStatus,
    ]);

    // Initialize when shown
    useEffect(() => {
        if (!isVisible) return;

        isActiveRef.current = true;
        setStep('checking');
        setExistingUser(null);
        setAuthUrl(null);
        setDevicePrompt(null);
        setStatus('Preparing login...');
        setError(null);

        void (async () => {
            try {
                const auth = await loadAuth();
                if (!isActiveRef.current) return;

                if (auth) {
                    setExistingUser(auth.email || auth.userId || 'user');
                    setStep('already-authenticated');
                    setStatus('You are already logged in');
                    return;
                }

                await startLogin();
            } catch (err) {
                if (!isActiveRef.current) return;
                setStep('error');
                setStatus('Error checking authentication state');
                setError(err instanceof Error ? err.message : String(err));
            }
        })();

        return () => {
            isActiveRef.current = false;
            cancelInFlight();
        };
    }, [cancelInFlight, isVisible, startLogin]);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) return false;

                if (key.escape) {
                    cancelInFlight();
                    onDone({ outcome: step === 'already-authenticated' ? 'closed' : 'cancelled' });
                    return true;
                }

                if (step === 'already-authenticated' && key.return) {
                    void startLogin();
                    return true;
                }

                if (step === 'error' && key.return) {
                    void startLogin();
                    return true;
                }

                return true;
            },
        }),
        [cancelInFlight, isVisible, onDone, startLogin, step]
    );

    if (!isVisible) return null;

    const hint =
        step === 'already-authenticated'
            ? 'Enter to login again • Esc to close'
            : step === 'error'
              ? 'Enter to retry • Esc to close'
              : 'Esc to cancel';

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            marginTop={1}
        >
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Login to Dexto
                </Text>
            </Box>

            {existingUser && step === 'already-authenticated' && (
                <Box marginBottom={1}>
                    <Text color="green">✅ Already logged in as: {existingUser}</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text color="gray">Status: </Text>
                <Text>{status}</Text>
            </Box>

            {devicePrompt && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">Open this URL on any device:</Text>
                    <Text color="yellowBright">
                        {devicePrompt.verificationUrlComplete ?? devicePrompt.verificationUrl}
                    </Text>
                    <Text color="gray">Code: {devicePrompt.userCode}</Text>
                </Box>
            )}

            {authUrl && !devicePrompt && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">If your browser didn&apos;t open, use this URL:</Text>
                    <Text color="yellowBright">{authUrl}</Text>
                </Box>
            )}

            {error && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="red">Error: {error}</Text>
                </Box>
            )}

            <Box>
                <Text color="gray" dimColor>
                    {hint}
                </Text>
            </Box>
        </Box>
    );
});

export default LoginOverlay;
