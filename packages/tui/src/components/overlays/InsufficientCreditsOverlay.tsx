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
import { buildDextoBillingUrl, openDextoBillingPage } from '../../host/index.js';

type OverlayStep = 'select' | 'waiting';
type OpenedBillingTarget = string | null;

interface ActionOption {
    id:
        | 'top-up-25'
        | 'top-up-10'
        | 'top-up-50'
        | 'open-billing'
        | 'reopen'
        | 'different-amount'
        | 'done';
    label: string;
    description: string;
    amountUsd?: number | undefined;
}

const TOP_UP_OPTIONS: ActionOption[] = [
    {
        id: 'top-up-25',
        label: 'Top up $25',
        description: 'Recommended quick recharge',
        amountUsd: 25,
    },
    {
        id: 'top-up-10',
        label: 'Top up $10',
        description: 'Small top-up',
        amountUsd: 10,
    },
    {
        id: 'top-up-50',
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
        id: 'reopen',
        label: 'Open billing page again',
        description: 'Return to billing or sign in in your browser',
    },
    {
        id: 'different-amount',
        label: 'Choose a different amount',
        description: 'Open billing with another amount prefilled',
    },
    {
        id: 'done',
        label: 'Close and retry manually',
        description: 'Return to chat once billing is handled',
    },
];

function formatBalance(balanceUsd: number | null): string | null {
    if (balanceUsd === null) {
        return null;
    }

    return `$${balanceUsd.toFixed(2)}`;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface InsufficientCreditsOverlayProps {
    isVisible: boolean;
    initialBalanceUsd: number | null;
    onResolved: () => void;
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
    const [openedBillingTarget, setOpenedBillingTarget] = useState<OpenedBillingTarget>(null);
    const [statusMessage, setStatusMessage] = useState(
        'Choose a top-up option. Dexto will open billing in your browser.'
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Working...');
    const [isLoading, setIsLoading] = useState(false);

    const options = useMemo(() => {
        return step === 'select' ? TOP_UP_OPTIONS : WAITING_OPTIONS;
    }, [step]);

    const selectorTitle = step === 'select' ? 'Billing Options' : 'Next Step';

    const resetToSelection = useCallback(() => {
        setStep('select');
        setSelectedIndex(0);
        setOpenedBillingTarget(null);
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
        setBalanceUsd(initialBalanceUsd);
        resetToSelection();

        return () => {
            isActiveRef.current = false;
        };
    }, [initialBalanceUsd, isVisible, resetToSelection]);

    const openBillingTarget = useCallback(
        async (options: {
            url?: string | undefined;
            loadingMessage: string;
            statusMessage: string;
        }) => {
            setErrorMessage(null);
            setIsLoading(true);
            setLoadingMessage(options.loadingMessage);

            try {
                await openDextoBillingPage({ url: options.url });
                if (!isActiveRef.current) {
                    return;
                }

                setOpenedBillingTarget(options.url ?? null);
                setStep('waiting');
                setSelectedIndex(0);
                setStatusMessage(options.statusMessage);
            } catch (error) {
                if (!isActiveRef.current) {
                    return;
                }

                setOpenedBillingTarget(options.url ?? null);
                setStep('waiting');
                setSelectedIndex(0);
                setErrorMessage(getErrorMessage(error));
                setStatusMessage('Billing is ready to open again once your browser is available.');
            } finally {
                if (isActiveRef.current) {
                    setIsLoading(false);
                }
            }
        },
        []
    );

    const openBillingDashboard = useCallback(async () => {
        await openBillingTarget({
            loadingMessage: 'Opening billing page...',
            statusMessage:
                'Billing opened in your browser. If needed, the site will ask you to sign in before you continue. Once payment is complete, close this prompt and retry your request here.',
        });
    }, [openBillingTarget]);

    const openPrefilledBilling = useCallback(
        async (creditsUsd: number) => {
            const billingUrl = buildDextoBillingUrl({ creditsUsd });

            await openBillingTarget({
                url: billingUrl,
                loadingMessage: `Opening $${creditsUsd} billing page...`,
                statusMessage: `Opened a $${creditsUsd} top-up flow in your browser. If needed, the site will ask you to sign in before you continue. Once payment is complete, close this prompt and retry your request here.`,
            });
        },
        [openBillingTarget]
    );

    const reopenBilling = useCallback(async () => {
        setErrorMessage(null);
        setIsLoading(true);
        setLoadingMessage('Opening billing page...');

        try {
            await openDextoBillingPage({ url: openedBillingTarget ?? undefined });
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
    }, [openedBillingTarget]);

    const handleSelect = useCallback(
        (option: ActionOption) => {
            if (typeof option.amountUsd === 'number') {
                void openPrefilledBilling(option.amountUsd);
                return;
            }

            switch (option.id) {
                case 'open-billing':
                    void openBillingDashboard();
                    return;
                case 'reopen':
                    void reopenBilling();
                    return;
                case 'different-amount':
                    resetToSelection();
                    return;
                case 'done':
                    onResolved();
                    return;
            }
        },
        [onResolved, openBillingDashboard, openPrefilledBilling, reopenBilling, resetToSelection]
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

                return selectorRef.current?.handleInput(input, key) ?? false;
            },
        }),
        [isVisible]
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
                <Text color="gray">
                    This request stopped because your Dexto Nova balance ran out.
                </Text>
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
