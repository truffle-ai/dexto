/**
 * PluginList Component
 * Displays list of installed plugins with details
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { listInstalledPlugins, type ListedPlugin } from '@dexto/agent-management';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface PluginListProps {
    isVisible: boolean;
    onPluginSelect: (plugin: ListedPlugin) => void;
    onClose: () => void;
}

export interface PluginListHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface PluginListItem extends ListedPlugin {
    displayLabel: string;
}

/**
 * Plugin list overlay - shows installed plugins
 */
const PluginList = forwardRef<PluginListHandle, PluginListProps>(function PluginList(
    { isVisible, onPluginSelect, onClose },
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

    const [plugins, setPlugins] = useState<PluginListItem[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    // Load plugins when visible
    useEffect(() => {
        if (isVisible) {
            setIsLoading(true);
            try {
                const installedPlugins = listInstalledPlugins();
                const pluginItems: PluginListItem[] = installedPlugins.map((plugin) => ({
                    ...plugin,
                    displayLabel: `${plugin.name}@${plugin.version || 'unknown'}`,
                }));
                setPlugins(pluginItems);
            } catch {
                setPlugins([]);
            } finally {
                setIsLoading(false);
                setSelectedIndex(0);
            }
        }
    }, [isVisible]);

    // Format plugin for display
    const formatItem = (plugin: PluginListItem, isSelected: boolean) => {
        const scopeLabel = plugin.scope ? ` [${plugin.scope}]` : '';

        return (
            <Box flexDirection="column">
                <Box>
                    <Text>📦 </Text>
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {plugin.name}
                    </Text>
                    <Text color={isSelected ? 'white' : 'gray'}>
                        @{plugin.version || 'unknown'}
                    </Text>
                    {scopeLabel && (
                        <Text color="yellow" dimColor={!isSelected}>
                            {scopeLabel}
                        </Text>
                    )}
                </Box>
                {plugin.description && (
                    <Box marginLeft={3}>
                        <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                            {plugin.description}
                        </Text>
                    </Box>
                )}
                {isSelected && (
                    <Box marginLeft={3}>
                        <Text color="gray" dimColor>
                            {plugin.path}
                        </Text>
                    </Box>
                )}
                {isSelected && (
                    <Box marginLeft={3}>
                        <Text color="green" dimColor>
                            Press Enter to manage
                        </Text>
                    </Box>
                )}
            </Box>
        );
    };

    // Handle selection - navigate to plugin actions
    const handleSelect = (plugin: PluginListItem) => {
        onPluginSelect(plugin);
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={plugins}
            isVisible={isVisible}
            isLoading={isLoading}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title={`Installed Plugins (${plugins.length})`}
            borderColor="cyan"
            emptyMessage="No plugins installed"
        />
    );
});

export default PluginList;
