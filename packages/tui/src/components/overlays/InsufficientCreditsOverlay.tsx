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
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import {
    createBillingCheckoutForCurrentLogin,
    getBillingBalanceForCurrentLogin,
    openDextoBillingPage,
} from '../../host/index.js';

type OverlayStep = 'select' | 'waiting' | 'success';
type OpenedTarget = { kind: 'checkout'; url: string } | { kind: 'generic' } | null;

interface ActionOption {
    id: 'top-up' | 'open-billing' | 'refresh' | 'reopen' | 'different-amount' | 'close';
    label: string;
    description: string;
    amountUsd?: number | undefined;
}

const TOP_UP_OPTIONS: ActionOption[] = [
    {
        id: 'top-up',
        label: 'Top up $25',
        description: 'Recommended quick recharge',
        amountUsd: 25,
    },
    {
        id: 'top-up',
        label: 'Top up $10',
        description: 'Small top-up',
        amountUsd: 10,
    },
    {
        id: 'top-up',
        label: 'Top up $50',
        description: 'Larger credit pack',
        amountUsd: 50,
    },
    {
        id: 'open-billing',
        label: 'Open billing page',
        description: 'View full billing dashboard',
    },
];

const WAITING_OPTIONS: ActionOption[] = [
    {
        id: 'refresh',
        label: 'Refresh balance',
        description: 'Check whether your credits have updated',
    },
    {
        id: 'different-amount',
        label: 'Choose a different amount',
        description: 'Create another top-up session',
    },
    {
        id: 'close',
        label: 'Close',
        description: 'Dismiss this prompt',
    },
];

const SUCCESS_OPTIONS: ActionOption[] = [
    {
        id: 'close',
        label: 'Close',
        description: 'Return to the conversation',
    },
];

function formatBalance(balanceUsd: number | null): string | null {
    if (balanceUsd === null) {
        return null;
    }

    return `$${balanceUsd.toFixed(2)}`;
}

function getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Not logged in to Dexto') {
        return 'Billing top-up requires an active Dexto login. Run `dexto login` again.';
    }
    return message;
}

export interface InsufficientCreditsOverlayProps {
    isVisible: boolean;
    initialBalanceUsd: number | null;
    onResolved: (balanceUsd: number | null) => void;
    onClose: () => void;
}

export interface InsufficientCreditsOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

const InsufficientCreditsOverlay = forwardRef<
    InsufficientCreditsOverlayHandle,
    InsufficientCreditsOverlayProps
>(function InsufficientCreditsOverlay({ isVisible, initialBalanceUsd, onResolved, onClose }, ref) {
    const selectorRef = useRef<BaseSelectorHandle>(null);
    const isActiveRef = useRef(false);

    const [step, setStep] = useState<OverlayStep>('select');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [balanceUsd, setBalanceUsd] = useState<number | null>(initialBalanceUsd);
    const [openedTarget, setOpenedTarget] = useState<OpenedTarget>(null);
    const [statusMessage, setStatusMessage] = useState(
        'Choose a top-up option. Dexto will open billing in your browser.'
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Working...');
    const [isLoading, setIsLoading] = useState(false);

    const options = useMemo(() => {
        if (step === 'select') {
            return TOP_UP_OPTIONS;
        }

        if (step === 'success') {
            return SUCCESS_OPTIONS;
        }

        const reopenOption: ActionOption =
            openedTarget?.kind === 'checkout'
                ? {
                      id: 'reopen',
                      label: 'Reopen checkout',
                      description: 'Open the current top-up checkout again',
                  }
                : {
                      id: 'reopen',
                      label: 'Open billing page',
                      description: 'Open the billing dashboard again',
                  };

        return [WAITING_OPTIONS[0], reopenOption, WAITING_OPTIONS[1], WAITING_OPTIONS[2]].filter(
            (option): option is ActionOption => option !== undefined
        );
    }, [openedTarget, step]);

    const selectorTitle =
        step === 'select'
            ? 'Billing Options'
            : step === 'success'
              ? 'Next Step'
              : 'Billing Actions';

    const introMessage =
        step === 'success'
            ? 'Your credits are available again. Retry the request when you are ready.'
            : 'This request stopped because your Dexto Nova balance ran out.';

    const resetToSelection = useCallback((nextBalanceUsd: number | null) => {
        setStep('select');
        setSelectedIndex(0);
        setBalanceUsd(nextBalanceUsd);
        setOpenedTarget(null);
        setErrorMessage(null);
        setStatusMessage('Choose a top-up option. Dexto will open billing in your browser.');
        setIsLoading(false);
        setLoadingMessage('Working...');
    }, []);

    useEffect(() => {
        if (!isVisible) {
            isActiveRef.current = false;
            return;
        }

        isActiveRef.current = true;
        resetToSelection(initialBalanceUsd);

        return () => {
            isActiveRef.current = false;
        };
    }, [initialBalanceUsd, isVisible, resetToSelection]);

    const refreshBalance = useCallback(async () => {
        setErrorMessage(null);
        setIsLoading(true);
        setLoadingMessage('Refreshing balance...');

        try {
            const nextBalanceUsd = await getBillingBalanceForCurrentLogin();
            if (!isActiveRef.current) {
                return;
            }

            setBalanceUsd(nextBalanceUsd);
            setIsLoading(false);

            const previousBalanceUsd = balanceUsd;
            const balanceIncreased =
                nextBalanceUsd !== null &&
                ((previousBalanceUsd === null && nextBalanceUsd > 0) ||
                    (previousBalanceUsd !== null && nextBalanceUsd > previousBalanceUsd));

            if (balanceIncreased) {
                setStep('success');
                setSelectedIndex(0);
                setStatusMessage(
                    `Balance updated to ${formatBalance(nextBalanceUsd)}. You can retry your request now.`
                );
                return;
            }

            setStep('waiting');
            if (nextBalanceUsd === null) {
                setStatusMessage(
                    'Balance is still unavailable. Complete payment, then refresh again.'
                );
                return;
            }

            setStatusMessage(
                `Current balance: ${formatBalance(nextBalanceUsd)}. Complete payment, then refresh again.`
            );
        } catch (error) {
            if (!isActiveRef.current) {
                return;
            }

            setIsLoading(false);
            setStep('waiting');
            setErrorMessage(getErrorMessage(error));
        }
    }, [balanceUsd]);

    const openBillingDashboard = useCallback(async () => {
        setErrorMessage(null);
        setIsLoading(true);
        setLoadingMessage('Opening billing page...');

        try {
            await openDextoBillingPage();
            if (!isActiveRef.current) {
                return;
            }

            setOpenedTarget({ kind: 'generic' });
            setStep('waiting');
            setSelectedIndex(0);
            setStatusMessage(
                'Billing opened in your browser. Complete payment, then refresh your balance.'
            );
        } catch (error) {
            if (!isActiveRef.current) {
                return;
            }

            setStep('waiting');
            setOpenedTarget({ kind: 'generic' });
            setErrorMessage(getErrorMessage(error));
            setStatusMessage(
                'Billing is ready to open again when your browser session is available.'
            );
        } finally {
            if (isActiveRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    const createCheckout = useCallback(async (creditsUsd: number) => {
        setErrorMessage(null);
        setIsLoading(true);
        setLoadingMessage(`Creating $${creditsUsd} checkout...`);

        try {
            const checkout = await createBillingCheckoutForCurrentLogin({ creditsUsd });
            if (!isActiveRef.current) {
                return;
            }

            setOpenedTarget({ kind: 'checkout', url: checkout.checkoutUrl });

            try {
                await openDextoBillingPage(checkout.checkoutUrl);
                if (!isActiveRef.current) {
                    return;
                }

                setStep('waiting');
                setSelectedIndex(0);
                setStatusMessage(
                    `Opened a $${creditsUsd} checkout in your browser. Complete payment, then refresh your balance.`
                );
            } catch (error) {
                if (!isActiveRef.current) {
                    return;
                }

                setStep('waiting');
                setSelectedIndex(0);
                setErrorMessage(getErrorMessage(error));
                setStatusMessage(
                    'Checkout was created successfully. Open it again once your browser is ready.'
                );
            }
        } catch (error) {
            if (!isActiveRef.current) {
                return;
            }

            setStep('select');
            setSelectedIndex(0);
            setErrorMessage(getErrorMessage(error));
        } finally {
            if (isActiveRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    const reopenBilling = useCallback(async () => {
        if (!openedTarget) {
            return;
        }

        setErrorMessage(null);
        setIsLoading(true);
        setLoadingMessage('Opening billing...');

        try {
            if (openedTarget.kind === 'checkout') {
                await openDextoBillingPage(openedTarget.url);
            } else {
                await openDextoBillingPage();
            }
        } catch (error) {
            if (!isActiveRef.current) {
                return;
            }

            setErrorMessage(getErrorMessage(error));
        } finally {
            if (isActiveRef.current) {
                setIsLoading(false);
            }
        }
    }, [openedTarget]);

    const handleSelect = useCallback(
        (option: ActionOption) => {
            switch (option.id) {
                case 'top-up':
                    if (typeof option.amountUsd === 'number') {
                        void createCheckout(option.amountUsd);
                    }
                    return;
                case 'open-billing':
                    void openBillingDashboard();
                    return;
                case 'refresh':
                    void refreshBalance();
                    return;
                case 'reopen':
                    void reopenBilling();
                    return;
                case 'different-amount':
                    resetToSelection(balanceUsd);
                    return;
                case 'close':
                    if (step === 'success') {
                        onResolved(balanceUsd);
                        return;
                    }
                    onClose();
                    return;
            }
        },
        [
            balanceUsd,
            createCheckout,
            onClose,
            onResolved,
            openBillingDashboard,
            refreshBalance,
            reopenBilling,
            resetToSelection,
            step,
        ]
    );

    const formatItem = useCallback((option: ActionOption, isSelected: boolean) => {
        return (
            <>
                <Text color={isSelected ? 'yellow' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
            </>
        );
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) {
                    return false;
                }

                if (step === 'success' && key.escape) {
                    onResolved(balanceUsd);
                    return true;
                }

                return selectorRef.current?.handleInput(input, key) ?? false;
            },
        }),
        [balanceUsd, isVisible, onResolved, step]
    );

    if (!isVisible) {
        return null;
    }

    return (
        <Box flexDirection="column">
            <Box>
                <Text color="yellow" bold>
                    Out of Dexto Nova credits
                </Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
                <Text color="gray">{introMessage}</Text>
                {formatBalance(balanceUsd) && (
                    <Text color="gray">Current balance: {formatBalance(balanceUsd)}</Text>
                )}
            </Box>

            <Box flexDirection="column" marginTop={1}>
                <Text>{statusMessage}</Text>
                {errorMessage && <Text color="red">{errorMessage}</Text>}
            </Box>

            <Box marginTop={1}>
                <BaseSelector
                    ref={selectorRef}
                    items={options}
                    isVisible={true}
                    isLoading={isLoading}
                    selectedIndex={selectedIndex}
                    onSelectIndex={setSelectedIndex}
                    onSelect={handleSelect}
                    onClose={onClose}
                    formatItem={formatItem}
                    title={selectorTitle}
                    borderColor="yellow"
                    maxVisibleItems={6}
                    loadingMessage={loadingMessage}
                    emptyMessage="No billing actions available"
                />
            </Box>
        </Box>
    );
});

export default InsufficientCreditsOverlay;
