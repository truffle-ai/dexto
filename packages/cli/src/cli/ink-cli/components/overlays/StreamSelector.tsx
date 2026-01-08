/**
 * StreamSelector Component
 * Interactive selector for toggling streaming mode
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import { isStreamingEnabled, setStreamingEnabled } from '../../state/streaming-state.js';

interface StreamSelectorProps {
    isVisible: boolean;
    onSelect: (enabled: boolean) => void;
    onClose: () => void;
}

export interface StreamSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface StreamOption {
    id: 'enabled' | 'disabled';
    label: string;
    description: string;
    icon: string;
    isCurrent: boolean;
}

/**
 * Stream selector - toggle streaming on/off
 */
const StreamSelector = forwardRef<StreamSelectorHandle, StreamSelectorProps>(
    function StreamSelector({ isVisible, onSelect, onClose }, ref) {
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

        const [options, setOptions] = useState<StreamOption[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Build options list with current indicator
        useEffect(() => {
            if (!isVisible) return;

            const currentEnabled = isStreamingEnabled();
            const optionList: StreamOption[] = [
                {
                    id: 'enabled',
                    label: 'Enabled (Experimental)',
                    description: 'Show responses as they are generated',
                    icon: '▶️',
                    isCurrent: currentEnabled,
                },
                {
                    id: 'disabled',
                    label: 'Disabled',
                    description: 'Show complete response when finished (default)',
                    icon: '⏸️',
                    isCurrent: !currentEnabled,
                },
            ];

            setOptions(optionList);

            // Set initial selection to current state
            setSelectedIndex(currentEnabled ? 0 : 1);
        }, [isVisible]);

        // Format option item for display
        const formatItem = (option: StreamOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
                {option.isCurrent && (
                    <Text color="green" bold>
                        {' '}
                        ✓
                    </Text>
                )}
            </>
        );

        // Handle selection
        const handleSelect = (option: StreamOption) => {
            const enabled = option.id === 'enabled';
            setStreamingEnabled(enabled);
            onSelect(enabled);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={options}
                isVisible={isVisible}
                isLoading={false}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Streaming Mode"
                borderColor="cyan"
                emptyMessage="No options available"
            />
        );
    }
);

export default StreamSelector;
