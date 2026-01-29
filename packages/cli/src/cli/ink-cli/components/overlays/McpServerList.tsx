/**
 * McpServerList Component
 * Shows list of configured MCP servers with their status
 * First screen of /mcp command - select a server or add new
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
import type { DextoAgent, McpServerStatus, McpConnectionStatus } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type McpServerListAction =
    | { type: 'select-server'; server: McpServerStatus }
    | { type: 'add-new' };

interface McpServerListProps {
    isVisible: boolean;
    onAction: (action: McpServerListAction) => void;
    onClose: () => void;
    agent: DextoAgent;
}

export interface McpServerListHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ListItem {
    id: string;
    isAddNew: boolean;
    server?: McpServerStatus;
}

/**
 * Get status icon based on server state
 */
function getStatusIcon(status: McpConnectionStatus): string {
    switch (status) {
        case 'connected':
            return '🟢';
        case 'disconnected':
            return '⚪';
        case 'auth-required':
            return '🔐';
        case 'error':
            return '🔴';
    }
}

/**
 * Get status text based on server state
 */
function getStatusText(status: McpConnectionStatus): string {
    switch (status) {
        case 'connected':
            return 'connected';
        case 'disconnected':
            return 'disabled';
        case 'auth-required':
            return 'auth required';
        case 'error':
            return 'failed';
    }
}

/**
 * MCP Server List - shows all configured servers and add option
 */
const McpServerList = forwardRef<McpServerListHandle, McpServerListProps>(function McpServerList(
    { isVisible, onAction, onClose, agent },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [servers, setServers] = useState<McpServerStatus[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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

    // Load servers when becoming visible
    useEffect(() => {
        if (isVisible) {
            setIsLoading(true);
            setSelectedIndex(0);

            // Get all servers with computed status from agent
            const serverList = agent.getMcpServersWithStatus();

            // Sort: connected first, then disconnected, then error
            serverList.sort((a, b) => {
                const order: Record<McpConnectionStatus, number> = {
                    connected: 0,
                    disconnected: 1,
                    'auth-required': 2,
                    error: 3,
                };
                return order[a.status] - order[b.status];
            });

            setServers(serverList);
            setIsLoading(false);
        }
    }, [isVisible, agent]);

    // Build list items: servers + "Add new server" at bottom
    const items = useMemo<ListItem[]>(() => {
        const list: ListItem[] = servers.map((server) => ({
            id: server.name,
            isAddNew: false,
            server,
        }));

        // Add "Add new server" option at the end
        list.push({
            id: '__add_new__',
            isAddNew: true,
        });

        return list;
    }, [servers]);

    // Format item for display
    const formatItem = (item: ListItem, isSelected: boolean) => {
        if (item.isAddNew) {
            return (
                <Box>
                    <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                        + Add new server
                    </Text>
                </Box>
            );
        }

        const server = item.server!;
        const statusIcon = getStatusIcon(server.status);
        const statusText = getStatusText(server.status);

        return (
            <Box>
                <Text>{statusIcon} </Text>
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {server.name}
                </Text>
                <Text color="gray"> ({server.type}) </Text>
                <Text
                    color={
                        server.status === 'connected'
                            ? 'green'
                            : server.status === 'disconnected'
                              ? 'gray'
                              : server.status === 'auth-required'
                                ? 'yellow'
                                : 'red'
                    }
                >
                    [{statusText}]
                </Text>
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (item: ListItem) => {
        if (item.isAddNew) {
            onAction({ type: 'add-new' });
        } else if (item.server) {
            onAction({ type: 'select-server', server: item.server });
        }
    };

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
            title="MCP Servers"
            borderColor="magenta"
            emptyMessage="No servers configured"
        />
    );
});

export default McpServerList;
