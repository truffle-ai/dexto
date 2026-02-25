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
    type TuiDextoApiKeyProvisionStatus as DextoApiKeyProvisionStatus,
    beginOAuthLogin,
    getDefaultOAuthConfig,
    ensureDextoApiKeyForAuthToken,
    loadAuth,
    storeAuth,
} from '../../host/index.js';

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

const LoginOverlay = forwardRef<LoginOverlayHandle, LoginOverlayProps>(function LoginOverlay(
    { isVisible, onDone },
    ref
) {
    const [step, setStep] = useState<LoginStep>('checking');
    const [existingUser, setExistingUser] = useState<string | null>(null);
    const [authUrl, setAuthUrl] = useState<string | null>(null);
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

    const startLogin = useCallback(async () => {
        cancelInFlight();
        setError(null);
        setAuthUrl(null);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            setStep('starting');
            safeSetStatus('Starting local callback server...');

            const session = await beginOAuthLogin(getDefaultOAuthConfig(), {
                signal: abortController.signal,
            });
            if (!isActiveRef.current || abortController.signal.aborted) return;

            setAuthUrl(session.authUrl);
            setStep('opening-browser');
            safeSetStatus('Opening browser for authentication...');

            let browserOpened = false;
            try {
                const { default: open } = await import('open');
                await open(session.authUrl);
                browserOpened = true;
            } catch {
                // Best-effort: user can open URL manually
            }

            if (!isActiveRef.current || abortController.signal.aborted) return;

            setStep('waiting');
            safeSetStatus(
                browserOpened
                    ? 'Waiting for authentication...'
                    : 'Browser did not open automatically. Open the URL below to continue.'
            );

            const result = await session.result;
            if (!isActiveRef.current || abortController.signal.aborted) return;

            setStep('finalizing');
            safeSetStatus('Finalizing login...');

            const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
            await storeAuth({
                token: result.accessToken,
                refreshToken: result.refreshToken,
                userId: result.user?.id,
                email: result.user?.email,
                createdAt: Date.now(),
                expiresAt,
            });

            safeSetStatus('Provisioning Dexto API key (DEXTO_API_KEY)...');
            const ensured = await ensureDextoApiKeyForAuthToken(result.accessToken, {
                onStatus: handleProvisionStatus,
            });

            if (!isActiveRef.current || abortController.signal.aborted) return;
            onDone({
                outcome: 'success',
                email: result.user?.email,
                keyId: ensured?.keyId ?? undefined,
                hasDextoApiKey: Boolean(ensured?.dextoApiKey),
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
    }, [cancelInFlight, handleProvisionStatus, onDone, safeSetStatus]);

    // Initialize when shown
    useEffect(() => {
        if (!isVisible) return;

        isActiveRef.current = true;
        setStep('checking');
        setExistingUser(null);
        setAuthUrl(null);
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

            {authUrl && (
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
