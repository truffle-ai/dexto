/**
 * SessionSubcommandSelector Component
 * Shows session management options (list, history, delete, switch)
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type SessionAction = 'list' | 'history' | 'delete' | 'switch';

interface SessionSubcommandSelectorProps {
    isVisible: boolean;
    onSelect: (action: SessionAction) => void;
    onClose: () => void;
}

export interface SessionSubcommandSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface SessionOption {
    action: SessionAction;
    label: string;
    description: string;
    icon: string;
}

const SESSION_OPTIONS: SessionOption[] = [
    { action: 'list', label: 'list', description: 'List all sessions', icon: '📋' },
    { action: 'switch', label: 'switch', description: 'Switch to another session', icon: '🔄' },
    { action: 'history', label: 'history', description: 'Show session history', icon: '📜' },
    { action: 'delete', label: 'delete', description: 'Delete a session', icon: '🗑️' },
];

/**
 * Session subcommand selector - shows session management options
 */
const SessionSubcommandSelector = forwardRef<
    SessionSubcommandSelectorHandle,
    SessionSubcommandSelectorProps
>(function SessionSubcommandSelector({ isVisible, onSelect, onClose }, ref) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);

    // Forward handleInput to BaseSelector
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                return baseSelectorRef.current?.handleInput(input, key) ?? false;
            },
        }),
        []
    );

    const [options] = useState<SessionOption[]>(SESSION_OPTIONS);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format option for display
    const formatItem = (option: SessionOption, isSelected: boolean) => (
        <>
            <Text>{option.icon} </Text>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {option.label}
            </Text>
            <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
        </>
    );

    // Handle selection
    const handleSelect = (option: SessionOption) => {
        onSelect(option.action);
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={options}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title="Session Management"
            borderColor="blue"
            emptyMessage="No options available"
        />
    );
});

export default SessionSubcommandSelector;
