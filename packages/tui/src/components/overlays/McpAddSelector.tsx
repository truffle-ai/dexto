/**
 * McpAddSelector Component
 * Shows registry presets for adding MCP servers
 * (Custom server options are handled separately via McpSelector "add custom")
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { serverRegistry, type ServerRegistryEntry } from '@dexto/registry';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type McpAddResult = { type: 'preset'; entry: ServerRegistryEntry };

interface McpAddSelectorProps {
    isVisible: boolean;
    onSelect: (result: McpAddResult) => void;
    onClose: () => void;
}

export interface McpAddSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface McpAddOption {
    id: string;
    label: string;
    description: string;
    icon: string;
    entry: ServerRegistryEntry;
}

/**
 * MCP add selector - shows registry presets only
 */
const McpAddSelector = forwardRef<McpAddSelectorHandle, McpAddSelectorProps>(
    function McpAddSelector({ isVisible, onSelect, onClose }, ref) {
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

        const [options, setOptions] = useState<McpAddOption[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Fetch registry entries
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;
            setIsLoading(true);

            const fetchEntries = async () => {
                try {
                    const entries = await serverRegistry.getEntries();

                    if (cancelled) return;

                    // Only show presets that are not already installed
                    const availablePresets = entries.filter((e) => !e.isInstalled);
                    const optionList: McpAddOption[] = availablePresets.map((entry) => ({
                        id: entry.id,
                        label: entry.name,
                        description: entry.description,
                        icon: entry.icon || '📦',
                        entry,
                    }));

                    setOptions(optionList);
                    setSelectedIndex(0);
                } catch {
                    // On error, options remain empty - BaseSelector will show emptyMessage
                    if (!cancelled) {
                        setOptions([]);
                    }
                } finally {
                    if (!cancelled) {
                        setIsLoading(false);
                    }
                }
            };

            void fetchEntries();

            return () => {
                cancelled = true;
            };
        }, [isVisible]);

        // Format option for display
        const formatItem = (option: McpAddOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}>
                    {' '}
                    - {option.description.slice(0, 40)}
                    {option.description.length > 40 ? '...' : ''}
                </Text>
            </>
        );

        // Handle selection
        const handleSelect = (option: McpAddOption) => {
            onSelect({ type: 'preset', entry: option.entry });
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={options}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Add MCP Server (Presets)"
                borderColor="green"
                loadingMessage="Loading server presets..."
                emptyMessage="No server presets available"
            />
        );
    }
);

export default McpAddSelector;
