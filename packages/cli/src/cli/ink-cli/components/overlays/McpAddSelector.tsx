/**
 * McpAddSelector Component
 * Shows registry presets and custom server options for adding MCP servers
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text, type Key } from 'ink';
import { serverRegistry, type ServerRegistryEntry } from '@dexto/registry';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type McpAddResult =
    | { type: 'preset'; entry: ServerRegistryEntry }
    | { type: 'custom'; serverType: 'stdio' | 'http' | 'sse' };

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
    type: 'preset' | 'custom';
    label: string;
    description: string;
    icon: string;
    entry?: ServerRegistryEntry;
    serverType?: 'stdio' | 'http' | 'sse';
    isHeader?: boolean;
}

const CUSTOM_OPTIONS: McpAddOption[] = [
    {
        id: 'custom-stdio',
        type: 'custom',
        label: 'STDIO server',
        description: 'Add custom stdio server',
        icon: '▶️',
        serverType: 'stdio',
    },
    {
        id: 'custom-http',
        type: 'custom',
        label: 'HTTP server',
        description: 'Add custom HTTP server',
        icon: '🌐',
        serverType: 'http',
    },
    {
        id: 'custom-sse',
        type: 'custom',
        label: 'SSE server',
        description: 'Add custom SSE server',
        icon: '📡',
        serverType: 'sse',
    },
];

/**
 * MCP add selector - shows registry presets and custom options
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

                    // Build options list: presets first, then custom
                    const optionList: McpAddOption[] = [];

                    // Add preset entries (not installed ones)
                    const availablePresets = entries.filter((e) => !e.isInstalled);
                    for (const entry of availablePresets) {
                        optionList.push({
                            id: entry.id,
                            type: 'preset',
                            label: entry.name,
                            description: entry.description,
                            icon: entry.icon || '📦',
                            entry,
                        });
                    }

                    // Add custom options at the end
                    optionList.push(...CUSTOM_OPTIONS);

                    setOptions(optionList);
                    setSelectedIndex(0);
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
        const formatItem = (option: McpAddOption, isSelected: boolean) => {
            const isCustom = option.type === 'custom';

            return (
                <>
                    <Text>{option.icon} </Text>
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {option.label}
                    </Text>
                    <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                        {' '}
                        - {option.description.slice(0, 40)}
                        {option.description.length > 40 ? '...' : ''}
                    </Text>
                    {isCustom && (
                        <Text color="yellow" dimColor={!isSelected}>
                            {' '}
                            [Custom]
                        </Text>
                    )}
                </>
            );
        };

        // Handle selection
        const handleSelect = (option: McpAddOption) => {
            if (option.type === 'preset' && option.entry) {
                onSelect({ type: 'preset', entry: option.entry });
            } else if (option.type === 'custom' && option.serverType) {
                onSelect({ type: 'custom', serverType: option.serverType });
            }
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
                title="Add MCP Server"
                borderColor="green"
                loadingMessage="Loading server presets..."
                emptyMessage="No server presets available"
            />
        );
    }
);

export default McpAddSelector;
