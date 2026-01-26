/**
 * PluginActions Component
 * Clean action menu for a selected plugin
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
    icon: string;
    color: string;
}

/**
 * Plugin Actions - action menu for a specific plugin
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
                id: 'back',
                type: 'back' as const,
                label: 'Back to list',
                icon: '←',
                color: 'gray',
            },
            {
                id: 'uninstall',
                type: 'uninstall' as const,
                label: 'Uninstall',
                icon: '🗑',
                color: 'red',
            },
        ];
    }, [plugin]);

    // Format item for display - clean single line
    const formatItem = (item: ActionItem, isSelected: boolean) => {
        const isBack = item.type === 'back';

        return (
            <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={isBack ? 'gray' : isSelected ? item.color : 'gray'}>{item.icon} </Text>
                <Text
                    color={
                        isBack ? (isSelected ? 'white' : 'gray') : isSelected ? item.color : 'white'
                    }
                    bold={isSelected && !isBack}
                >
                    {item.label}
                </Text>
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (item: ActionItem) => {
        if (!plugin) return;
        onAction({ type: item.type, plugin });
    };

    if (!plugin) return null;

    const version = plugin.version || 'unknown';
    const scopeBadge = plugin.scope ? ` [${plugin.scope}]` : '';
    const title = `📦 ${plugin.name}@${version}${scopeBadge}`;

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
            title={title}
            borderColor="magenta"
            emptyMessage="No actions available"
        />
    );
});

export default PluginActions;
