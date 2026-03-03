/**
 * McpRemoveSelector Component
 * Shows installed MCP servers for removal
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent, McpServerStatus, McpConnectionStatus } from '@dexto/core';
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

        const [servers, setServers] = useState<McpServerStatus[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Fetch installed servers
        useEffect(() => {
            if (!isVisible) return;

            setIsLoading(true);

            try {
                // Get servers with computed status from agent
                const serverList = agent.getMcpServersWithStatus();

                // Sort alphabetically
                serverList.sort((a, b) => a.name.localeCompare(b.name));

                setServers(serverList);
                setSelectedIndex(0);
            } finally {
                setIsLoading(false);
            }
        }, [isVisible, agent]);

        // Get display icon for status
        const getStatusIcon = (status: McpConnectionStatus): string => {
            switch (status) {
                case 'connected':
                    return '🔌';
                case 'disconnected':
                    return '⏸️';
                case 'auth-required':
                    return '🔐';
                case 'error':
                    return '!';
            }
        };

        // Get display text for status
        const getStatusText = (status: McpConnectionStatus): string => {
            switch (status) {
                case 'connected':
                    return 'Connected';
                case 'disconnected':
                    return 'Disabled';
                case 'auth-required':
                    return 'Auth required';
                case 'error':
                    return 'Failed';
            }
        };

        // Format server item for display
        const formatItem = (server: McpServerStatus, isSelected: boolean) => (
            <>
                <Text>{getStatusIcon(server.status)} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {server.name}
                </Text>
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
                    {' '}
                    - {getStatusText(server.status)}
                </Text>
                {server.error && (
                    <Text color="gray">
                        {' '}
                        ({server.error.slice(0, 30)}
                        {server.error.length > 30 ? '...' : ''})
                    </Text>
                )}
            </>
        );

        // Handle selection
        const handleSelect = (server: McpServerStatus) => {
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
