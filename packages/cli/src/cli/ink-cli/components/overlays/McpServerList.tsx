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
import type { DextoAgent } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export interface McpServerInfo {
    name: string;
    enabled: boolean;
    status: 'connected' | 'disabled' | 'failed';
    type: 'stdio' | 'http' | 'sse';
}

export type McpServerListAction =
    | { type: 'select-server'; server: McpServerInfo }
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
    server?: McpServerInfo;
}

/**
 * Get status icon based on server state
 */
function getStatusIcon(status: 'connected' | 'disabled' | 'failed'): string {
    switch (status) {
        case 'connected':
            return '🟢';
        case 'disabled':
            return '⚪';
        case 'failed':
            return '🔴';
    }
}

/**
 * Get status text based on server state
 */
function getStatusText(status: 'connected' | 'disabled' | 'failed'): string {
    switch (status) {
        case 'connected':
            return 'connected';
        case 'disabled':
            return 'disabled';
        case 'failed':
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
    const [servers, setServers] = useState<McpServerInfo[]>([]);
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

            // Get all configured servers from effective config
            const config = agent.getEffectiveConfig();
            const mcpServers = config.mcpServers || {};

            // Get connected and failed servers
            const connectedClients = agent.getMcpClients();
            const failedConnections = agent.getMcpFailedConnections();

            const serverList: McpServerInfo[] = [];

            for (const [name, serverConfig] of Object.entries(mcpServers)) {
                const enabled = serverConfig.enabled !== false; // default true
                let status: 'connected' | 'disabled' | 'failed';

                if (!enabled) {
                    status = 'disabled';
                } else if (connectedClients.has(name)) {
                    status = 'connected';
                } else if (failedConnections[name]) {
                    status = 'failed';
                } else {
                    // Not connected yet but enabled - treat as failed/pending
                    status = 'failed';
                }

                serverList.push({
                    name,
                    enabled,
                    status,
                    type: serverConfig.type,
                });
            }

            // Sort: connected first, then disabled, then failed
            serverList.sort((a, b) => {
                const order = { connected: 0, disabled: 1, failed: 2 };
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
                            : server.status === 'disabled'
                              ? 'gray'
                              : 'red'
                    }
                    dimColor={!isSelected}
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
