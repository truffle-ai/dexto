/**
 * LogLevelSelector Component
 * Interactive selector for changing log level
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface LogLevelSelectorProps {
    isVisible: boolean;
    onSelect: (level: string) => void;
    onClose: () => void;
    agent: DextoAgent;
    sessionId: string | null;
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

// Log levels matching DextoLogger's supported levels
const LOG_LEVELS: { level: string; description: string; icon: string }[] = [
    { level: 'error', description: 'Errors only', icon: '❌' },
    { level: 'warn', description: 'Warnings and above', icon: '⚠️' },
    { level: 'info', description: 'Info and above (default)', icon: 'ℹ️' },
    { level: 'debug', description: 'Debug information', icon: '🔍' },
    { level: 'silly', description: 'Everything (most verbose)', icon: '🔬' },
];

/**
 * Log level selector - thin wrapper around BaseSelector
 */
const LogLevelSelector = forwardRef<LogLevelSelectorHandle, LogLevelSelectorProps>(
    function LogLevelSelector({ isVisible, onSelect, onClose, agent, sessionId }, ref) {
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
        const [logFilePath, setLogFilePath] = useState<string | null>(null);

        // Build levels list with current indicator
        useEffect(() => {
            let isCancelled = false;

            const run = async () => {
                if (!isVisible) {
                    setLogFilePath(null);
                    return;
                }

                // Get current level from agent's logger (shared across all child loggers)
                const currentLevel = agent.logger.getLevel();
                const levelList = LOG_LEVELS.map((l) => ({
                    ...l,
                    isCurrent: l.level === currentLevel,
                }));

                setLevels(levelList);

                // File logging is session-scoped; prefer the active session logger if available.
                const session = sessionId ? await agent.getSession(sessionId) : undefined;
                if (!isCancelled) {
                    setLogFilePath(session?.logger.getLogFilePath() ?? null);
                }

                // Set initial selection to current level
                const currentIndex = levelList.findIndex((l) => l.isCurrent);
                if (currentIndex >= 0) {
                    setSelectedIndex(currentIndex);
                }
            };

            void run();

            return () => {
                isCancelled = true;
            };
        }, [isVisible, agent, sessionId]);

        // Format level item for display
        const formatItem = (option: LogLevelOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.level}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
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
            <Box flexDirection="column">
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
                    borderColor="yellowBright"
                    emptyMessage="No log levels available"
                />
                {logFilePath && process.env.DEXTO_DEV_MODE === 'true' && (
                    <Box marginTop={1}>
                        <Text color="gray">📁 Log file: {logFilePath}</Text>
                    </Box>
                )}
            </Box>
        );
    }
);

export default LogLevelSelector;
