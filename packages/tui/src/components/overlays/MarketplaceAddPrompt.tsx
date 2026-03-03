/**
 * MarketplaceAddPrompt Component
 * Prompts user to enter a marketplace source to add
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import { addMarketplace } from '@dexto/agent-management';
import { logger } from '@dexto/core';
import type { Key } from '../../hooks/useInputOrchestrator.js';

interface MarketplaceAddPromptProps {
    isVisible: boolean;
    onComplete: (name: string, pluginCount: number) => void;
    onClose: () => void;
}

export interface MarketplaceAddPromptHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Marketplace add prompt - single input for source
 */
const MarketplaceAddPrompt = forwardRef<MarketplaceAddPromptHandle, MarketplaceAddPromptProps>(
    function MarketplaceAddPrompt({ isVisible, onComplete, onClose }, ref) {
        const [input, setInput] = useState('');
        const [error, setError] = useState<string | null>(null);
        const [isAdding, setIsAdding] = useState(false);

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                setInput('');
                setError(null);
                setIsAdding(false);
            }
        }, [isVisible]);

        // Handle adding marketplace
        const handleAdd = useCallback(async () => {
            const source = input.trim();
            if (!source) {
                setError('Please enter a marketplace source');
                return;
            }

            setError(null);
            setIsAdding(true);

            try {
                const result = await addMarketplace(source);
                onComplete(result.name, result.pluginCount);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                setError(errorMessage);
                logger.error(`MarketplaceAddPrompt.handleAdd failed: ${errorMessage}`);
            } finally {
                setIsAdding(false);
            }
        }, [input, onComplete]);

        // Handle input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (inputStr: string, key: Key): boolean => {
                    // Escape to close
                    if (key.escape) {
                        onClose();
                        return true;
                    }

                    // Enter to submit
                    if (key.return) {
                        if (!isAdding) {
                            handleAdd();
                        }
                        return true;
                    }

                    // Backspace
                    if (key.backspace || key.delete) {
                        setInput((prev) => prev.slice(0, -1));
                        setError(null);
                        return true;
                    }

                    // Regular character input
                    if (inputStr && !key.ctrl && !key.meta) {
                        setInput((prev) => prev + inputStr);
                        setError(null);
                        return true;
                    }

                    return false;
                },
            }),
            [handleAdd, isAdding, onClose]
        );

        if (!isVisible) return null;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="green"
                paddingX={1}
                marginTop={1}
            >
                <Box marginBottom={1}>
                    <Text bold color="green">
                        Add Marketplace
                    </Text>
                </Box>

                <Box marginBottom={1}>
                    <Text color="gray">Enter marketplace source:</Text>
                </Box>
                <Box marginBottom={1} flexDirection="column">
                    <Text color="gray" dimColor>
                        - GitHub: owner/repo (e.g., anthropics/claude-plugins-official)
                    </Text>
                    <Text color="gray" dimColor>
                        - Git URL: https://github.com/user/repo.git
                    </Text>
                    <Text color="gray" dimColor>
                        - Local: /path/to/marketplace or ~/marketplace
                    </Text>
                </Box>

                <Box>
                    <Text color="cyan">{'> '}</Text>
                    <Text>{input}</Text>
                    <Text color="cyan">_</Text>
                </Box>

                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}

                {isAdding && (
                    <Box marginTop={1}>
                        <Text color="yellow">Adding marketplace...</Text>
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text color="gray" dimColor>
                        Press Enter to add, Escape to cancel
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default MarketplaceAddPrompt;
