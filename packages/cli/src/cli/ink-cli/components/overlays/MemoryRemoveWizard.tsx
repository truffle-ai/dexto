/**
 * MemoryRemoveWizard Component
 * Interactive overlay for removing memory entries (Scope -> Selection)
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { MemoryAddScope, MemoryRemoveWizardState } from '../../state/types.js';

interface MemoryRemoveWizardProps {
    isVisible: boolean;
    state: MemoryRemoveWizardState | null;
    projectEntries: string[];
    globalEntries: string[];
    onUpdateState: (updates: Partial<MemoryRemoveWizardState>) => void;
    onComplete: (index: number, scope: MemoryAddScope) => void;
    onClose: () => void;
}

export interface MemoryRemoveWizardHandle {
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
        hint: 'Remove from this workspace (./AGENTS.md)',
    },
    {
        scope: 'global',
        label: 'User Memory',
        hint: 'Remove from global instructions (~/.dexto/AGENTS.md)',
    },
];

/**
 * Memory remove wizard overlay - guides user through removing a memory entry
 */
const MemoryRemoveWizard = forwardRef<MemoryRemoveWizardHandle, MemoryRemoveWizardProps>(
    function MemoryRemoveWizard(
        { isVisible, state, projectEntries, globalEntries, onUpdateState, onComplete, onClose },
        ref
    ) {
        const scopeSelectorRef = useRef<BaseSelectorHandle>(null);
        const entrySelectorRef = useRef<BaseSelectorHandle>(null);
        const [entryIndex, setEntryIndex] = useState(0);

        // Reset state when becoming visible
        useEffect(() => {
            if (isVisible && !state) {
                onUpdateState({ step: 'scope', scope: null });
            }
            if (state?.step === 'selection') {
                setEntryIndex(0);
            }
        }, [isVisible, state?.step, onUpdateState]);

        const handleScopeSelect = (option: ScopeOption) => {
            onUpdateState({ step: 'selection', scope: option.scope });
        };

        const handleEntrySelect = (entry: string) => {
            if (!state?.scope) return;
            onComplete(entryIndex, state.scope);
        };

        // Forward handleInput
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible || !state) return false;

                    // Step 1: Scope Selection
                    if (state.step === 'scope') {
                        return scopeSelectorRef.current?.handleInput(input, key) ?? false;
                    }

                    // Step 2: Entry Selection
                    if (state.step === 'selection') {
                        // Escape to go back to scope selection
                        if (key.escape) {
                            onUpdateState({ step: 'scope', scope: null });
                            return true;
                        }

                        return entrySelectorRef.current?.handleInput(input, key) ?? false;
                    }

                    return false;
                },
            }),
            [isVisible, state, onUpdateState]
        );

        if (!isVisible || !state) return null;

        // Render Step 1: Scope Selection
        if (state.step === 'scope') {
            const formatItem = (option: ScopeOption, isSelected: boolean) => (
                <Box>
                    <Text color={isSelected ? 'red' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
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
                    ref={scopeSelectorRef}
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
                    title="Select Scope to Remove From"
                    borderColor="red"
                    emptyMessage="No options available"
                />
            );
        }

        // Render Step 2: Entry Selection
        const entries = state.scope === 'global' ? globalEntries : projectEntries;

        const formatEntry = (entry: string, isSelected: boolean) => (
            <Box>
                <Text color={isSelected ? 'red' : 'gray'}>{isSelected ? '× ' : '  '}</Text>
                <Text color={isSelected ? 'white' : 'gray'}>
                    {entry.length > 80 ? entry.slice(0, 77) + '...' : entry}
                </Text>
            </Box>
        );

        return (
            <BaseSelector
                ref={entrySelectorRef}
                items={entries}
                isVisible={isVisible}
                isLoading={false}
                selectedIndex={entryIndex}
                onSelectIndex={setEntryIndex}
                onSelect={handleEntrySelect}
                onClose={() => onUpdateState({ step: 'scope', scope: null })}
                formatItem={(entry, isSelected) => formatEntry(entry as string, isSelected)}
                title={`Select Entry to Remove (${state.scope === 'global' ? 'User' : 'Project'})`}
                borderColor="red"
                emptyMessage={`No ${state.scope} memory entries found`}
            />
        );
    }
);

export default MemoryRemoveWizard;
