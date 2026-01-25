/**
 * PluginManager Component
 * Interactive plugin management overlay - list, install, import plugins
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PluginAction = 'list' | 'import' | 'back';

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
    { action: 'list', label: 'List Plugins', description: 'View installed plugins', icon: '📋' },
    {
        action: 'import',
        label: 'Import Plugin',
        description: 'Import Claude Code plugin',
        icon: '⬇️',
    },
    { action: 'back', label: 'Back', description: 'Close plugin manager', icon: '◀️' },
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
        <>
            <Text>{option.icon} </Text>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {option.label}
            </Text>
            <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
        </>
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
