/**
 * PluginActions Component
 * Shows actions for a selected installed plugin: uninstall
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
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { ListedPlugin } from '@dexto/agent-management';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PluginActionType = 'uninstall' | 'back';

export interface PluginActionResult {
    type: PluginActionType;
    plugin: ListedPlugin;
}

interface PluginActionsProps {
    isVisible: boolean;
    plugin: ListedPlugin | null;
    onAction: (action: PluginActionResult) => void;
    onClose: () => void;
}

export interface PluginActionsHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ActionItem {
    id: string;
    type: PluginActionType;
    label: string;
    description: string;
    icon: string;
    color: string;
}

/**
 * Plugin Actions - uninstall for a specific plugin
 */
const PluginActions = forwardRef<PluginActionsHandle, PluginActionsProps>(function PluginActions(
    { isVisible, plugin, onAction, onClose },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

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

    // Reset selection when becoming visible or plugin changes
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible, plugin]);

    // Build action items
    const items = useMemo<ActionItem[]>(() => {
        if (!plugin) return [];

        return [
            {
                id: 'uninstall',
                type: 'uninstall' as const,
                label: 'Uninstall plugin',
                description: 'Remove this plugin from your system',
                icon: '🗑️',
                color: 'red',
            },
            {
                id: 'back',
                type: 'back' as const,
                label: 'Back to plugin list',
                description: 'Return to the list of installed plugins',
                icon: '←',
                color: 'gray',
            },
        ];
    }, [plugin]);

    // Format item for display
    const formatItem = (item: ActionItem, isSelected: boolean) => {
        return (
            <Box flexDirection="column">
                <Box>
                    <Text>{item.icon} </Text>
                    <Text color={isSelected ? item.color : 'gray'} bold={isSelected}>
                        {item.label}
                    </Text>
                </Box>
                <Box marginLeft={3}>
                    <Text color="gray" dimColor={!isSelected}>
                        {item.description}
                    </Text>
                </Box>
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (item: ActionItem) => {
        if (!plugin) return;
        onAction({ type: item.type, plugin });
    };

    if (!plugin) return null;

    const scopeLabel = plugin.scope ? ` [${plugin.scope}]` : '';

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={items}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title={`📦 ${plugin.name}@${plugin.version || 'unknown'}${scopeLabel}`}
            borderColor="magenta"
            emptyMessage="No actions available"
        />
    );
});

export default PluginActions;
