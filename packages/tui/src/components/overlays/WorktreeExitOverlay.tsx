import React, { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';

export interface WorktreeExitOverlayProps {
    isVisible: boolean;
    worktreeName: string;
    worktreePath: string;
    parentProjectRoot: string;
    onKeep: () => void;
    onRemove: () => void;
    onCancel: () => void;
}

export interface WorktreeExitOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type WorktreeExitChoice = 'keep' | 'remove';

export const WorktreeExitOverlay = forwardRef<WorktreeExitOverlayHandle, WorktreeExitOverlayProps>(
    function WorktreeExitOverlay(
        { isVisible, worktreeName, worktreePath, parentProjectRoot, onKeep, onRemove, onCancel },
        ref
    ) {
        const [selectedIndex, setSelectedIndex] = useState(0);
        const choices = [
            {
                key: 'keep' as const,
                label: 'Keep worktree',
                description: 'Leave directory and branch as-is, can resume later',
            },
            {
                key: 'remove' as const,
                label: 'Remove worktree',
                description: `Delete directory and branch, enables clean recreation (parent: ${parentProjectRoot ?? 'unknown'})`,
            },
        ] satisfies Array<{ key: WorktreeExitChoice; label: string; description: string }>;

        const handleConfirm = useCallback(() => {
            const selectedChoice = choices[selectedIndex];
            if (selectedChoice && selectedChoice.key === 'keep') {
                onKeep();
            } else if (selectedChoice) {
                onRemove();
            }
        }, [selectedIndex, choices, onKeep, onRemove]);

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (_input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    if (key.escape) {
                        onCancel();
                        return true;
                    }

                    if (key.return) {
                        handleConfirm();
                        return true;
                    }

                    if (key.upArrow) {
                        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
                        return true;
                    }

                    if (key.downArrow) {
                        setSelectedIndex((prev) => (prev < choices.length - 1 ? prev + 1 : prev));
                        return true;
                    }

                    return true;
                },
            }),
            [isVisible, choices.length, onCancel, handleConfirm]
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
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Worktree Exit — {worktreeName}
                    </Text>
                </Box>

                <Box marginBottom={1}>
                    <Text dimColor>Path: </Text>
                    <Text>{worktreePath}</Text>
                </Box>

                <Box marginBottom={1}>
                    <Text color="gray">Choose what to do with this worktree when exiting:</Text>
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    {choices.map((choice, index) => (
                        <Box key={choice.key} marginLeft={1}>
                            <Text color={selectedIndex === index ? 'cyan' : 'gray'}>
                                {selectedIndex === index ? '▶ ' : '  '}
                                <Text bold={selectedIndex === index}>{choice.label}</Text>
                                {' — '}
                                <Text dimColor>{choice.description}</Text>
                            </Text>
                        </Box>
                    ))}
                </Box>

                <Box>
                    <Text color="gray" dimColor>
                        ↑↓ navigate • Enter confirm • Esc cancel
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default WorktreeExitOverlay;
