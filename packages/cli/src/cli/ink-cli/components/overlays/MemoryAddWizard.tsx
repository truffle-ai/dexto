/**
 * MemoryAddWizard Component
 * Interactive overlay for adding new memory entries (Scope -> Content)
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useCallback,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { MemoryAddScope, MemoryAddWizardState } from '../../state/types.js';

interface MemoryAddWizardProps {
    isVisible: boolean;
    state: MemoryAddWizardState | null;
    onUpdateState: (updates: Partial<MemoryAddWizardState>) => void;
    onComplete: (content: string, scope: MemoryAddScope) => void;
    onClose: () => void;
}

export interface MemoryAddWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ScopeOption {
    scope: MemoryAddScope;
    label: string;
    hint: string;
}

const SCOPE_OPTIONS: ScopeOption[] = [
    {
        scope: 'project',
        label: 'Project Memory',
        hint: 'Specific to this workspace (./AGENTS.md)',
    },
    {
        scope: 'global',
        label: 'User Memory',
        hint: 'Global instructions for all projects (~/.dexto/AGENTS.md)',
    },
];

/**
 * Memory add wizard overlay - guides user through adding a memory entry
 */
const MemoryAddWizard = forwardRef<MemoryAddWizardHandle, MemoryAddWizardProps>(
    function MemoryAddWizard({ isVisible, state, onUpdateState, onComplete, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

        // Reset state when becoming visible
        useEffect(() => {
            if (isVisible && !state) {
                onUpdateState({ step: 'scope', scope: null, content: '' });
            }
        }, [isVisible, state, onUpdateState]);

        const handleScopeSelect = (option: ScopeOption) => {
            onUpdateState({ step: 'content', scope: option.scope });
        };

        const handleContentSubmit = useCallback(() => {
            if (!state?.content.trim() || !state.scope) return;
            onComplete(state.content, state.scope);
        }, [state, onComplete]);

        // Forward handleInput
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible || !state) return false;

                    // Step 1: Scope Selection (uses BaseSelector)
                    if (state.step === 'scope') {
                        return baseSelectorRef.current?.handleInput(input, key) ?? false;
                    }

                    // Step 2: Content Input
                    if (state.step === 'content') {
                        // Escape to go back to scope selection or close
                        if (key.escape) {
                            onUpdateState({ step: 'scope', scope: null });
                            return true;
                        }

                        // Enter to complete
                        if (key.return) {
                            handleContentSubmit();
                            return true;
                        }

                        // Backspace
                        if (key.backspace || key.delete) {
                            onUpdateState({ content: state.content.slice(0, -1) });
                            return true;
                        }

                        // Regular character input
                        if (input && !key.ctrl && !key.meta) {
                            onUpdateState({ content: state.content + input });
                            return true;
                        }
                    }

                    return false;
                },
            }),
            [isVisible, state, onUpdateState, handleContentSubmit]
        );

        if (!isVisible || !state) return null;

        // Render Step 1: Scope Selection
        if (state.step === 'scope') {
            const formatItem = (option: ScopeOption, isSelected: boolean) => (
                <Box>
                    <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                    <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                        {option.label}
                    </Text>
                    <Text color="gray" dimColor>
                        {' — '}
                        {option.hint}
                    </Text>
                </Box>
            );

            return (
                <BaseSelector
                    ref={baseSelectorRef}
                    items={SCOPE_OPTIONS}
                    isVisible={isVisible}
                    isLoading={false}
                    selectedIndex={state.scope === 'global' ? 1 : 0}
                    onSelectIndex={(idx) =>
                        onUpdateState({ scope: SCOPE_OPTIONS[idx]?.scope ?? null })
                    }
                    onSelect={handleScopeSelect}
                    onClose={onClose}
                    formatItem={formatItem}
                    title="Select Memory Scope"
                    borderColor="cyan"
                    emptyMessage="No options available"
                />
            );
        }

        // Render Step 2: Content Input
        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="cyan"
                paddingX={1}
                marginTop={1}
                minWidth={60}
            >
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Add {state.scope === 'global' ? 'User' : 'Project'} Memory
                    </Text>
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">Enter the memory content for the AI agent:</Text>
                </Box>

                <Box marginTop={1}>
                    <Text color="cyan">&gt; </Text>
                    <Text>{state.content}</Text>
                    <Text color="cyan">_</Text>
                </Box>

                <Box marginTop={1}>
                    <Text color="gray">Enter to save • Esc to go back</Text>
                </Box>
            </Box>
        );
    }
);

export default MemoryAddWizard;
