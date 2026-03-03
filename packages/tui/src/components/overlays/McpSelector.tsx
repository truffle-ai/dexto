/**
 * McpSelector Component
 * Main MCP selector - shows list, add, remove options
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type McpAction = 'list' | 'add-preset' | 'add-custom' | 'remove';

interface McpSelectorProps {
    isVisible: boolean;
    onSelect: (action: McpAction) => void;
    onClose: () => void;
}

export interface McpSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface McpOption {
    action: McpAction;
    label: string;
    description: string;
    icon: string;
}

const MCP_OPTIONS: McpOption[] = [
    { action: 'list', label: 'list', description: 'List connected servers', icon: '📋' },
    {
        action: 'add-preset',
        label: 'add preset',
        description: 'Add from registry presets',
        icon: '📦',
    },
    {
        action: 'add-custom',
        label: 'add custom',
        description: 'Add custom server (stdio/http/sse)',
        icon: '⚙️',
    },
    { action: 'remove', label: 'remove', description: 'Remove a server', icon: '🗑️' },
];

/**
 * MCP selector - shows main MCP actions
 */
const McpSelector = forwardRef<McpSelectorHandle, McpSelectorProps>(function McpSelector(
    { isVisible, onSelect, onClose },
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

    const [options] = useState<McpOption[]>(MCP_OPTIONS);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format option for display
    const formatItem = (option: McpOption, isSelected: boolean) => (
        <>
            <Text>{option.icon} </Text>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {option.label}
            </Text>
            <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
        </>
    );

    // Handle selection
    const handleSelect = (option: McpOption) => {
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
            title="MCP Servers"
            borderColor="magenta"
            emptyMessage="No options available"
        />
    );
});

export default McpSelector;
