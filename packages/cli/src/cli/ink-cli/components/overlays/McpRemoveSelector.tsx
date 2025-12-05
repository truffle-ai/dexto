/**
 * McpRemoveSelector Component
 * Shows installed MCP servers for removal
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text, type Key } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface McpRemoveSelectorProps {
    isVisible: boolean;
    onSelect: (serverName: string) => void;
    onClose: () => void;
    agent: DextoAgent;
}

export interface McpRemoveSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface McpServerOption {
    name: string;
    status: 'connected' | 'failed';
    error?: string;
}

/**
 * MCP remove selector - shows installed servers for removal
 */
const McpRemoveSelector = forwardRef<McpRemoveSelectorHandle, McpRemoveSelectorProps>(
    function McpRemoveSelector({ isVisible, onSelect, onClose, agent }, ref) {
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

        const [servers, setServers] = useState<McpServerOption[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Fetch installed servers
        useEffect(() => {
            if (!isVisible) return;

            setIsLoading(true);

            try {
                const clients = agent.getMcpClients();
                const failedConnections = agent.getMcpFailedConnections();

                const serverList: McpServerOption[] = [];

                // Add connected servers
                for (const [name] of clients) {
                    serverList.push({
                        name,
                        status: 'connected',
                    });
                }

                // Add failed servers
                for (const [name, error] of Object.entries(failedConnections)) {
                    serverList.push({
                        name,
                        status: 'failed',
                        error,
                    });
                }

                // Sort alphabetically
                serverList.sort((a, b) => a.name.localeCompare(b.name));

                setServers(serverList);
                setSelectedIndex(0);
            } finally {
                setIsLoading(false);
            }
        }, [isVisible, agent]);

        // Format server item for display
        const formatItem = (server: McpServerOption, isSelected: boolean) => (
            <>
                <Text>{server.status === 'connected' ? '🔌' : '❌'} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {server.name}
                </Text>
                <Text
                    color={server.status === 'connected' ? 'green' : 'red'}
                    dimColor={!isSelected}
                >
                    {' '}
                    - {server.status === 'connected' ? 'Connected' : 'Failed'}
                </Text>
                {server.error && (
                    <Text color="gray" dimColor>
                        {' '}
                        ({server.error.slice(0, 30)}
                        {server.error.length > 30 ? '...' : ''})
                    </Text>
                )}
            </>
        );

        // Handle selection
        const handleSelect = (server: McpServerOption) => {
            onSelect(server.name);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={servers}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Remove MCP Server"
                borderColor="red"
                loadingMessage="Loading servers..."
                emptyMessage="No MCP servers installed"
            />
        );
    }
);

export default McpRemoveSelector;
