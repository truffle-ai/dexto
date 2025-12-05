/**
 * LogLevelSelector Component
 * Interactive selector for changing log level
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text, type Key } from 'ink';
import { logger } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface LogLevelSelectorProps {
    isVisible: boolean;
    onSelect: (level: string) => void;
    onClose: () => void;
}

export interface LogLevelSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface LogLevelOption {
    level: string;
    description: string;
    icon: string;
    isCurrent: boolean;
}

const LOG_LEVELS: { level: string; description: string; icon: string }[] = [
    { level: 'error', description: 'Errors only', icon: '❌' },
    { level: 'warn', description: 'Warnings and above', icon: '⚠️' },
    { level: 'info', description: 'Info and above (default)', icon: 'ℹ️' },
    { level: 'http', description: 'HTTP requests and above', icon: '🌐' },
    { level: 'verbose', description: 'Verbose output', icon: '📝' },
    { level: 'debug', description: 'Debug information', icon: '🔍' },
    { level: 'silly', description: 'Everything', icon: '🔬' },
];

/**
 * Log level selector - thin wrapper around BaseSelector
 */
const LogLevelSelector = forwardRef<LogLevelSelectorHandle, LogLevelSelectorProps>(
    function LogLevelSelector({ isVisible, onSelect, onClose }, ref) {
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

        const [levels, setLevels] = useState<LogLevelOption[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Build levels list with current indicator
        useEffect(() => {
            if (!isVisible) return;

            const currentLevel = logger.getLevel();
            const levelList = LOG_LEVELS.map((l) => ({
                ...l,
                isCurrent: l.level === currentLevel,
            }));

            setLevels(levelList);

            // Set initial selection to current level
            const currentIndex = levelList.findIndex((l) => l.isCurrent);
            if (currentIndex >= 0) {
                setSelectedIndex(currentIndex);
            }
        }, [isVisible]);

        // Format level item for display
        const formatItem = (option: LogLevelOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.level}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                    {' '}
                    - {option.description}
                </Text>
                {option.isCurrent && (
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {' '}
                        ← Current
                    </Text>
                )}
            </>
        );

        // Handle selection
        const handleSelect = (option: LogLevelOption) => {
            onSelect(option.level);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={levels}
                isVisible={isVisible}
                isLoading={false}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Select Log Level"
                borderColor="yellow"
                emptyMessage="No log levels available"
            />
        );
    }
);

export default LogLevelSelector;
