/**
 * McpCustomTypeSelector Component
 * Shows server type options (stdio/http/sse) for custom MCP server
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { McpServerType } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import { tone } from '../../signal/index.js';

interface McpCustomTypeSelectorProps {
    isVisible: boolean;
    onSelect: (serverType: McpServerType) => void;
    onClose: () => void;
}

export interface McpCustomTypeSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ServerTypeOption {
    type: McpServerType;
    label: string;
    description: string;
    icon: string;
}

const SERVER_TYPE_OPTIONS: ServerTypeOption[] = [
    {
        type: 'stdio',
        label: 'STDIO',
        description: 'Local process (npx, uvx, node, python)',
        icon: '▶️',
    },
    {
        type: 'http',
        label: 'HTTP',
        description: 'Remote HTTP server',
        icon: '🌐',
    },
    {
        type: 'sse',
        label: 'SSE',
        description: 'Server-Sent Events endpoint',
        icon: '📡',
    },
];

/**
 * MCP custom type selector - picks server transport type
 */
const McpCustomTypeSelector = forwardRef<McpCustomTypeSelectorHandle, McpCustomTypeSelectorProps>(
    function McpCustomTypeSelector({ isVisible, onSelect, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        const [selectedIndex, setSelectedIndex] = useState(0);

        useEffect(() => {
            if (isVisible) {
                setSelectedIndex(0);
            }
        }, [isVisible]);

        const formatItem = (option: ServerTypeOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? tone('teal') : tone('dim')} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? tone('hi') : tone('dim')}> - {option.description}</Text>
            </>
        );

        const handleSelect = (option: ServerTypeOption) => {
            onSelect(option.type);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={SERVER_TYPE_OPTIONS}
                isVisible={isVisible}
                isLoading={false}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Select Server Type"
                borderColor={tone('amber')}
                emptyMessage="No options available"
            />
        );
    }
);

export default McpCustomTypeSelector;
