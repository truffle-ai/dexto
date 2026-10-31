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
import { currentSignIn, signIn } from '../../host/index.js';

export type LoginOverlayOutcome =
    | { outcome: 'success'; summary: string }
    | { outcome: 'cancelled' }
    | { outcome: 'closed' };

export interface LoginOverlayProps {
    isVisible: boolean;
    onDone: (outcome: LoginOverlayOutcome) => void;
}

export interface LoginOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type LoginStep = 'checking' | 'already-authenticated' | 'signing-in' | 'error';

const LoginOverlay = forwardRef<LoginOverlayHandle, LoginOverlayProps>(function LoginOverlay(
    { isVisible, onDone },
    ref
) {
    const [step, setStep] = useState<LoginStep>('checking');
    const [existingUser, setExistingUser] = useState<string | null>(null);
    const [signInNote, setSignInNote] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('Preparing sign-in...');
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isActiveRef = useRef(false);

    const safeSetStatus = useCallback((message: string) => {
        if (!isActiveRef.current) return;
        setStatus(message);
    }, []);

    const cancelInFlight = useCallback(() => {
        abortControllerRef.current?.abort(new Error('Authentication cancelled'));
        abortControllerRef.current = null;
    }, []);

    const startLogin = useCallback(async () => {
        cancelInFlight();
        setError(null);
        setSignInNote(null);
        setStep('signing-in');
        safeSetStatus('Signing in...');

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const summary = await signIn({
                signal: abortController.signal,
                onNote: (text) => {
                    if (!isActiveRef.current || abortController.signal.aborted) return;
                    setSignInNote(text);
                },
            });

            if (!isActiveRef.current || abortController.signal.aborted) return;
            onDone({ outcome: 'success', summary });
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }

            setStep('error');
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            safeSetStatus('Sign-in failed');
        } finally {
            abortControllerRef.current = null;
        }
    }, [cancelInFlight, onDone, safeSetStatus]);

    // Initialize when shown
    useEffect(() => {
        if (!isVisible) return;

        isActiveRef.current = true;
        setStep('checking');
        setExistingUser(null);
        setSignInNote(null);
        setStatus('Preparing sign-in...');
        setError(null);

        void (async () => {
            try {
                const signedInAs = await currentSignIn();
                if (!isActiveRef.current) return;

                if (signedInAs !== null) {
                    setExistingUser(signedInAs);
                    setStep('already-authenticated');
                    setStatus('You are already signed in');
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
            ? 'Enter to sign in again • Esc to close'
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
                    Sign in to Dexto
                </Text>
            </Box>

            {existingUser && step === 'already-authenticated' && (
                <Box marginBottom={1}>
                    <Text color="green">Signed in as {existingUser}</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text color="gray">Status: </Text>
                <Text>{status}</Text>
            </Box>

            {signInNote && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text>{signInNote}</Text>
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
