/**
 * MemoryManager Component
 * Main menu for memory management
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type MemoryAction = 'list' | 'add' | 'remove' | 'back';

interface MemoryManagerProps {
    isVisible: boolean;
    onAction: (action: MemoryAction) => void;
    onClose: () => void;
}

export interface MemoryManagerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface MemoryOption {
    action: MemoryAction;
    label: string;
    hint: string;
    icon: string;
}

const MEMORY_OPTIONS: MemoryOption[] = [
    {
        action: 'list',
        label: 'Show/List Memory',
        hint: 'View project and global entries',
        icon: '📝',
    },
    {
        action: 'add',
        label: 'Add Memory',
        hint: 'Add new project or global entry',
        icon: '➕',
    },
    {
        action: 'remove',
        label: 'Remove Memory',
        hint: 'Remove an existing entry',
        icon: '🗑️',
    },
    {
        action: 'back',
        label: 'Back',
        hint: '',
        icon: '←',
    },
];

/**
 * Memory manager overlay - main menu for memory management
 */
const MemoryManager = forwardRef<MemoryManagerHandle, MemoryManagerProps>(function MemoryManager(
    { isVisible, onAction, onClose },
    ref
) {
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

    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format option for display
    const formatItem = (option: MemoryOption, isSelected: boolean) => {
        const isBack = option.action === 'back';

        return (
            <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={isBack ? 'gray' : isSelected ? 'white' : 'gray'}>{option.icon} </Text>
                <Text color={isBack ? 'gray' : isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {option.label}
                </Text>
                {option.hint && (
                    <Text color="gray" dimColor>
                        {' '}
                        — {option.hint}
                    </Text>
                )}
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (option: MemoryOption) => {
        if (option.action === 'back') {
            onClose();
        } else {
            onAction(option.action);
        }
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={MEMORY_OPTIONS}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title="Memory Management"
            borderColor="cyan"
            emptyMessage="No options available"
        />
    );
});

export default MemoryManager;
