/**
 * PluginList Component
 * Clean table-like view of installed plugins
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
} from 'react';
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

interface BackItem {
    type: 'back';
}

interface PluginItem {
    type: 'plugin';
    plugin: ListedPlugin;
}

type ListItem = BackItem | PluginItem;

/**
 * Plugin list overlay - shows installed plugins in clean table format
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

    const [plugins, setPlugins] = useState<ListedPlugin[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    // Load plugins when visible
    useEffect(() => {
        if (isVisible) {
            setIsLoading(true);
            try {
                const installedPlugins = listInstalledPlugins();
                setPlugins(installedPlugins);
            } catch {
                setPlugins([]);
            } finally {
                setIsLoading(false);
                setSelectedIndex(0);
            }
        }
    }, [isVisible]);

    // Build list items with back option
    const items = useMemo<ListItem[]>(() => {
        const list: ListItem[] = [{ type: 'back' }];
        list.push(...plugins.map((plugin) => ({ type: 'plugin' as const, plugin })));
        return list;
    }, [plugins]);

    // Format item for display - clean single line with optional details
    const formatItem = (item: ListItem, isSelected: boolean) => {
        if (item.type === 'back') {
            return (
                <Box>
                    <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                    <Text color="gray">← </Text>
                    <Text color={isSelected ? 'white' : 'gray'}>Back to menu</Text>
                </Box>
            );
        }

        const plugin = item.plugin;
        const version = plugin.version || 'unknown';
        const scopeBadge = plugin.scope ? ` [${plugin.scope}]` : '';

        return (
            <Box flexDirection="column">
                <Box>
                    <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                    <Text color={isSelected ? 'white' : 'gray'}>📦 </Text>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {plugin.name}
                    </Text>
                    <Text color="gray" dimColor>
                        @{version}
                    </Text>
                    {scopeBadge && (
                        <Text color="yellow" dimColor>
                            {scopeBadge}
                        </Text>
                    )}
                </Box>
                {/* Show description and path only when selected */}
                {isSelected && plugin.description && (
                    <Box marginLeft={4}>
                        <Text color="gray">{plugin.description}</Text>
                    </Box>
                )}
                {isSelected && (
                    <Box marginLeft={4}>
                        <Text color="gray" dimColor>
                            {plugin.path}
                        </Text>
                    </Box>
                )}
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (item: ListItem) => {
        if (item.type === 'back') {
            onClose();
        } else {
            onPluginSelect(item.plugin);
        }
    };

    const pluginCount = plugins.length;
    const title = pluginCount > 0 ? `Installed Plugins (${pluginCount})` : 'Installed Plugins';

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={items}
            isVisible={isVisible}
            isLoading={isLoading}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title={title}
            borderColor="cyan"
            emptyMessage="No plugins installed. Browse the marketplace to find plugins."
        />
    );
});

export default PluginList;
