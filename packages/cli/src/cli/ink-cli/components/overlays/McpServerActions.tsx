/**
 * McpServerActions Component
 * Shows actions for a selected MCP server: enable/disable, delete
 * Second screen when selecting a server from McpServerList
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
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { McpServerInfo } from './McpServerList.js';

export type McpServerActionType = 'enable' | 'disable' | 'delete' | 'back';

export interface McpServerAction {
    type: McpServerActionType;
    server: McpServerInfo;
}

interface McpServerActionsProps {
    isVisible: boolean;
    server: McpServerInfo | null;
    onAction: (action: McpServerAction) => void;
    onClose: () => void;
}

export interface McpServerActionsHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ActionItem {
    id: string;
    type: McpServerActionType;
    label: string;
    icon: string;
    color: string;
}

/**
 * MCP Server Actions - enable/disable, delete for a specific server
 */
const McpServerActions = forwardRef<McpServerActionsHandle, McpServerActionsProps>(
    function McpServerActions({ isVisible, server, onAction, onClose }, ref) {
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

        // Reset selection when becoming visible or server changes
        useEffect(() => {
            if (isVisible) {
                setSelectedIndex(0);
            }
        }, [isVisible, server]);

        // Build action items based on server state
        const items = useMemo<ActionItem[]>(() => {
            if (!server) return [];

            const actions: ActionItem[] = [];

            // Enable/Disable based on current state
            if (server.enabled) {
                actions.push({
                    id: 'disable',
                    type: 'disable',
                    label: 'Disable server',
                    icon: '⏸️',
                    color: 'yellow',
                });
            } else {
                actions.push({
                    id: 'enable',
                    type: 'enable',
                    label: 'Enable server',
                    icon: '▶️',
                    color: 'green',
                });
            }

            // Delete option
            actions.push({
                id: 'delete',
                type: 'delete',
                label: 'Delete server',
                icon: '🗑️',
                color: 'red',
            });

            // Back option
            actions.push({
                id: 'back',
                type: 'back',
                label: 'Back to server list',
                icon: '←',
                color: 'gray',
            });

            return actions;
        }, [server]);

        // Format item for display
        const formatItem = (item: ActionItem, isSelected: boolean) => {
            return (
                <Box>
                    <Text>{item.icon} </Text>
                    <Text
                        color={isSelected ? item.color : 'gray'}
                        bold={isSelected}
                        dimColor={!isSelected}
                    >
                        {item.label}
                    </Text>
                </Box>
            );
        };

        // Handle selection
        const handleSelect = (item: ActionItem) => {
            if (!server) return;
            onAction({ type: item.type, server });
        };

        if (!server) return null;

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
                title={`Server: ${server.name}`}
                borderColor="magenta"
                emptyMessage="No actions available"
            />
        );
    }
);

export default McpServerActions;
