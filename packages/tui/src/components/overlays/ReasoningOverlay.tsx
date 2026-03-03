/**
 * ReasoningOverlay
 *
 * /reasoning UI:
 * - Toggle reasoning visibility (UI-only; does not affect provider behavior)
 * - Set/clear reasoning budget tokens when supported by the current provider+model
 *
 * Note: Reasoning variant is intentionally not edited here (Tab cycles variant).
 */

import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';
import { getModelDisplayName, getReasoningProfile } from '@dexto/core';
import { getLLMProviderDisplayName } from '../../utils/llm-provider-display.js';

export interface ReasoningOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ReasoningOverlayProps {
    isVisible: boolean;
    agent: DextoAgent;
    sessionId: string | null;
    showReasoning: boolean;
    onToggleShowReasoning: () => void;
    onSetBudgetTokens: (budgetTokens: number | undefined) => Promise<void>;
    onClose: () => void;
    onNotify: (message: string) => void;
}

type MenuItem =
    | { id: 'toggle-visibility'; label: string; description: string }
    | { id: 'set-budget'; label: string; description: string }
    | { id: 'clear-budget'; label: string; description: string };

export const ReasoningOverlay = React.forwardRef<ReasoningOverlayHandle, ReasoningOverlayProps>(
    function ReasoningOverlay(
        {
            isVisible,
            agent,
            sessionId,
            showReasoning,
            onToggleShowReasoning,
            onSetBudgetTokens,
            onClose,
            onNotify,
        },
        ref
    ) {
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [mode, setMode] = useState<'menu' | 'budget-input'>('menu');
        const [budgetInput, setBudgetInput] = useState('');
        const [error, setError] = useState<string | null>(null);
        const isSavingRef = useRef(false);

        const llmConfig = agent.getCurrentLLMConfig(sessionId || undefined);
        const provider = llmConfig.provider;
        const model = llmConfig.model;
        const support = getReasoningProfile(provider, model);
        const currentVariant = llmConfig.reasoning?.variant ?? support.defaultVariant ?? 'default';
        const currentBudgetTokens = llmConfig.reasoning?.budgetTokens;

        const menuItems = useMemo((): MenuItem[] => {
            const items: MenuItem[] = [
                {
                    id: 'toggle-visibility',
                    label: showReasoning ? 'Hide reasoning in chat' : 'Show reasoning in chat',
                    description: showReasoning
                        ? 'Keep tuning; hide reasoning blocks in the transcript'
                        : 'Show reasoning blocks in the transcript',
                },
            ];

            if (support.supportsBudgetTokens) {
                items.push({
                    id: 'set-budget',
                    label: 'Set reasoning budget tokens',
                    description: 'Advanced: cap/target reasoning budget (provider-specific)',
                });
                if (typeof currentBudgetTokens === 'number') {
                    items.push({
                        id: 'clear-budget',
                        label: 'Clear reasoning budget tokens',
                        description: `Currently ${currentBudgetTokens}; revert to provider default`,
                    });
                }
            }

            return items;
        }, [showReasoning, support.supportsBudgetTokens, currentBudgetTokens]);

        useEffect(() => {
            if (!isVisible) return;
            setSelectedIndex(0);
            setMode('menu');
            setBudgetInput('');
            setError(null);
            isSavingRef.current = false;
        }, [isVisible]);

        useEffect(() => {
            if (!isVisible) return;
            setSelectedIndex((prev) => {
                if (menuItems.length === 0) return 0;
                return Math.min(prev, menuItems.length - 1);
            });
        }, [isVisible, menuItems.length]);

        const handleMenuSelect = useCallback(
            (item: MenuItem) => {
                setError(null);

                if (item.id === 'toggle-visibility') {
                    onToggleShowReasoning();
                    onNotify(showReasoning ? 'Reasoning hidden' : 'Reasoning shown');
                    return;
                }

                if (item.id === 'set-budget') {
                    setMode('budget-input');
                    setBudgetInput(
                        typeof currentBudgetTokens === 'number' ? String(currentBudgetTokens) : ''
                    );
                    return;
                }

                if (item.id === 'clear-budget') {
                    void (async () => {
                        if (isSavingRef.current) return;
                        isSavingRef.current = true;
                        try {
                            await onSetBudgetTokens(undefined);
                            onNotify('Reasoning budget cleared');
                        } catch (e) {
                            setError(
                                `Failed to clear budget: ${e instanceof Error ? e.message : String(e)}`
                            );
                        } finally {
                            isSavingRef.current = false;
                        }
                    })();
                }
            },
            [currentBudgetTokens, onNotify, onSetBudgetTokens, onToggleShowReasoning, showReasoning]
        );

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape: back out of budget editing, otherwise close overlay.
                    if (key.escape) {
                        if (mode === 'budget-input') {
                            setMode('menu');
                            setError(null);
                            return true;
                        }
                        onClose();
                        return true;
                    }

                    if (mode === 'budget-input') {
                        if (isSavingRef.current) return true;

                        // Enter: submit
                        if (key.return) {
                            const trimmed = budgetInput.trim();
                            const parsed = Number.parseInt(trimmed, 10);
                            if (!trimmed) {
                                setError('Enter a positive integer (or Esc to cancel)');
                                return true;
                            }
                            if (!Number.isFinite(parsed) || parsed <= 0) {
                                setError('Budget tokens must be a positive integer');
                                return true;
                            }

                            void (async () => {
                                if (isSavingRef.current) return;
                                isSavingRef.current = true;
                                try {
                                    await onSetBudgetTokens(parsed);
                                    onNotify(`Reasoning budget set to ${parsed}`);
                                    setMode('menu');
                                    setError(null);
                                } catch (e) {
                                    setError(
                                        `Failed to set budget: ${e instanceof Error ? e.message : String(e)}`
                                    );
                                } finally {
                                    isSavingRef.current = false;
                                }
                            })();
                            return true;
                        }

                        // Backspace/delete
                        if (key.backspace || key.delete) {
                            setBudgetInput((prev) => prev.slice(0, -1));
                            setError(null);
                            return true;
                        }

                        // Digits only
                        if (input && !key.ctrl && !key.meta) {
                            if (/^\d+$/.test(input)) {
                                setBudgetInput((prev) => prev + input);
                                setError(null);
                                return true;
                            }
                        }

                        return true;
                    }

                    // Menu mode
                    if (menuItems.length > 0) {
                        if (key.upArrow) {
                            setSelectedIndex(
                                (prev) => (prev - 1 + menuItems.length) % menuItems.length
                            );
                            return true;
                        }
                        if (key.downArrow) {
                            setSelectedIndex((prev) => (prev + 1) % menuItems.length);
                            return true;
                        }
                        if (key.return) {
                            const item = menuItems[selectedIndex];
                            if (item) {
                                handleMenuSelect(item);
                                return true;
                            }
                        }
                    }

                    return false;
                },
            }),
            [budgetInput, handleMenuSelect, isVisible, menuItems, mode, onClose, selectedIndex]
        );

        if (!isVisible) return null;

        const providerLabel = getLLMProviderDisplayName(provider);
        const modelLabel = getModelDisplayName(model);

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
                        Reasoning
                    </Text>
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">
                        Model: <Text color="white">{modelLabel}</Text>{' '}
                        <Text color="gray">({providerLabel})</Text>
                    </Text>
                    <Text color="gray">
                        Variant: <Text color="white">{currentVariant}</Text>{' '}
                        <Text color="gray">(Tab cycles)</Text>
                    </Text>
                    <Text color="gray">
                        Visible: <Text color="white">{showReasoning ? 'on' : 'off'}</Text>
                    </Text>
                    <Text color="gray">
                        Budget tokens:{' '}
                        <Text color="white">
                            {support.supportsBudgetTokens
                                ? typeof currentBudgetTokens === 'number'
                                    ? String(currentBudgetTokens)
                                    : 'none'
                                : 'not supported'}
                        </Text>
                    </Text>
                    <Text color="gray">
                        Supported variants:{' '}
                        <Text color="white">{support.supportedVariants.join(', ')}</Text>
                    </Text>
                </Box>

                {mode === 'budget-input' ? (
                    <Box flexDirection="column">
                        <Text bold>Enter budget tokens:</Text>
                        <Box marginTop={1}>
                            <Text color="cyan">&gt; </Text>
                            <Text>{budgetInput}</Text>
                            {!isSavingRef.current && <Text color="cyan">_</Text>}
                        </Box>
                        <Box marginTop={1}>
                            <Text color="gray">Enter to save • Esc to cancel</Text>
                        </Box>
                    </Box>
                ) : (
                    <Box flexDirection="column">
                        {menuItems.length === 0 ? (
                            <Text color="gray">No reasoning options available for this model.</Text>
                        ) : (
                            <>
                                <Text color="cyan" bold>
                                    Options ({selectedIndex + 1}/{menuItems.length}) - ↑↓ navigate,
                                    Enter select, Esc close
                                </Text>
                                {menuItems.map((item, idx) => {
                                    const isSelected = idx === selectedIndex;
                                    return (
                                        <Box key={item.id} flexDirection="row" marginTop={0}>
                                            <Box width={2}>
                                                <Text color={isSelected ? 'cyan' : 'gray'}>
                                                    {isSelected ? '>' : ' '}
                                                </Text>
                                            </Box>
                                            <Box flexDirection="column">
                                                <Text
                                                    color={isSelected ? 'cyan' : 'gray'}
                                                    bold={isSelected}
                                                >
                                                    {item.label}
                                                </Text>
                                                <Text color="gray">{item.description}</Text>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </>
                        )}
                    </Box>
                )}

                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}
            </Box>
        );
    }
);
