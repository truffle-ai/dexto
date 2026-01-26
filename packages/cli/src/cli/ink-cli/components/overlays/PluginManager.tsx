/**
 * PluginManager Component
 * Interactive plugin management overlay - list installed plugins and browse marketplace
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PluginAction = 'list' | 'marketplace' | 'back';

interface PluginManagerProps {
    isVisible: boolean;
    onAction: (action: PluginAction) => void;
    onClose: () => void;
}

export interface PluginManagerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface PluginOption {
    action: PluginAction;
    label: string;
    description: string;
    icon: string;
}

const PLUGIN_OPTIONS: PluginOption[] = [
    {
        action: 'list',
        label: 'List Plugins',
        description: 'View and manage installed plugins',
        icon: '📋',
    },
    {
        action: 'marketplace',
        label: 'Marketplace',
        description: 'Browse and install from marketplaces',
        icon: '🛒',
    },
    { action: 'back', label: 'Back', description: 'Return to previous menu', icon: '←' },
];

/**
 * Plugin manager overlay - shows plugin management options
 */
const PluginManager = forwardRef<PluginManagerHandle, PluginManagerProps>(function PluginManager(
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

    const [options] = useState<PluginOption[]>(PLUGIN_OPTIONS);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format option for display
    const formatItem = (option: PluginOption, isSelected: boolean) => (
        <Box flexDirection="column">
            <Box>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
            </Box>
            <Box marginLeft={3}>
                <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                    {option.description}
                </Text>
            </Box>
        </Box>
    );

    // Handle selection
    const handleSelect = (option: PluginOption) => {
        if (option.action === 'back') {
            onClose();
        } else {
            onAction(option.action);
        }
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
            title="Plugin Manager"
            borderColor="magenta"
            emptyMessage="No options available"
        />
    );
});

export default PluginManager;
