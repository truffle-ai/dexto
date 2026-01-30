/**
 * SessionRenameOverlay Component
 * Interactive overlay for renaming the current session
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';

export interface SessionRenameOverlayProps {
    isVisible: boolean;
    currentTitle: string | undefined;
    onRename: (newTitle: string) => void;
    onClose: () => void;
}

export interface SessionRenameOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Session rename overlay - allows user to edit the session title
 */
const SessionRenameOverlay = forwardRef<SessionRenameOverlayHandle, SessionRenameOverlayProps>(
    function SessionRenameOverlay({ isVisible, currentTitle, onRename, onClose }, ref) {
        const [title, setTitle] = useState(currentTitle || '');
        const [error, setError] = useState<string | null>(null);

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                setTitle(currentTitle || '');
                setError(null);
            }
        }, [isVisible, currentTitle]);

        const handleSubmit = useCallback(() => {
            const trimmedTitle = title.trim();

            if (!trimmedTitle) {
                setError('Title cannot be empty');
                return;
            }

            onRename(trimmedTitle);
        }, [title, onRename]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape to close
                    if (key.escape) {
                        onClose();
                        return true;
                    }

                    // Enter to submit
                    if (key.return) {
                        handleSubmit();
                        return true;
                    }

                    // Backspace
                    if (key.backspace || key.delete) {
                        setTitle((prev) => prev.slice(0, -1));
                        setError(null);
                        return true;
                    }

                    // Regular character input
                    if (input && !key.ctrl && !key.meta) {
                        setTitle((prev) => prev + input);
                        setError(null);
                        return true;
                    }

                    return false;
                },
            }),
            [isVisible, onClose, handleSubmit]
        );

        if (!isVisible) return null;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="cyan"
                paddingX={1}
                marginTop={1}
            >
                {/* Header */}
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Rename Session
                    </Text>
                </Box>

                {/* Current title hint */}
                {currentTitle && (
                    <Box marginBottom={1}>
                        <Text color="gray">Current: </Text>
                        <Text color="white">{currentTitle}</Text>
                    </Box>
                )}

                {/* Input prompt */}
                <Box flexDirection="column">
                    <Text bold>Enter new title:</Text>
                </Box>

                {/* Input field */}
                <Box marginTop={1}>
                    <Text color="cyan">&gt; </Text>
                    <Text>{title}</Text>
                    <Text color="cyan">_</Text>
                </Box>

                {/* Error message */}
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text color="gray">Enter to save • Esc to cancel</Text>
                </Box>
            </Box>
        );
    }
);

export default SessionRenameOverlay;
