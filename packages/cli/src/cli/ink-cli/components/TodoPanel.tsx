/**
 * TodoPanel Component
 *
 * Displays the current todo list for workflow tracking.
 * Shows todos with their status indicators (pending, in progress, completed).
 *
 * Display modes:
 * - Processing + Collapsed: Shows "Next:" with the next pending/in-progress task
 * - Processing + Expanded: Shows simple checklist with ☐/☑ indicators below status bar
 * - Idle + Expanded: Shows boxed format with header
 * - Idle + Collapsed: Hidden
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem, TodoStatus } from '../state/types.js';

interface TodoPanelProps {
    todos: TodoItem[];
    /** Whether to show the full list or just the next task */
    isExpanded: boolean;
    /** Whether the agent is currently processing (affects display style) */
    isProcessing?: boolean;
}

/**
 * Get status indicator for a todo item (used in boxed mode)
 */
function getStatusIndicator(status: TodoStatus): { icon: string; color: string } {
    switch (status) {
        case 'completed':
            return { icon: '✓', color: 'green' };
        case 'in_progress':
            return { icon: '●', color: 'yellow' };
        case 'pending':
        default:
            return { icon: '○', color: 'gray' };
    }
}

/**
 * TodoPanel - Shows current todos for workflow tracking
 */
export function TodoPanel({ todos, isExpanded, isProcessing = false }: TodoPanelProps) {
    if (todos.length === 0) {
        return null;
    }

    // Sort todos by position
    const sortedTodos = [...todos].sort((a, b) => a.position - b.position);

    // Find the next task to work on (in_progress first, then first pending)
    const currentTask = sortedTodos.find((t) => t.status === 'in_progress');
    const nextPendingTask = sortedTodos.find((t) => t.status === 'pending');
    const nextTask = currentTask || nextPendingTask;

    // When idle (not processing)
    if (!isProcessing) {
        // Collapsed + idle = hidden
        if (!isExpanded) {
            return null;
        }

        // Expanded + idle = boxed format
        const completedCount = todos.filter((t) => t.status === 'completed').length;
        const totalCount = todos.length;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                marginX={1}
                marginBottom={1}
            >
                {/* Header */}
                <Box>
                    <Text bold color="cyan">
                        📋 Todo{' '}
                    </Text>
                    <Text color="gray">
                        ({completedCount}/{totalCount})
                    </Text>
                    <Text color="gray" dimColor>
                        {' '}
                        · ctrl+t to hide todo list
                    </Text>
                </Box>

                {/* Todo items */}
                <Box flexDirection="column">
                    {sortedTodos.map((todo) => {
                        const { icon, color } = getStatusIndicator(todo.status);
                        const isCompleted = todo.status === 'completed';
                        const isInProgress = todo.status === 'in_progress';

                        return (
                            <Box key={todo.id}>
                                <Text color={color}>{icon} </Text>
                                <Text
                                    color={isCompleted ? 'gray' : isInProgress ? 'white' : 'gray'}
                                    strikethrough={isCompleted}
                                    dimColor={!isInProgress && !isCompleted}
                                >
                                    {isInProgress ? todo.activeForm : todo.content}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        );
    }

    // When processing - use minimal style

    // Collapsed: show current task being worked on
    if (!isExpanded) {
        if (!currentTask) {
            return null; // No active task
        }

        return (
            <Box paddingX={1} marginBottom={1}>
                <Box marginLeft={2}>
                    <Text color="gray">⎿ </Text>
                    <Text color="gray">{currentTask.activeForm}</Text>
                </Box>
            </Box>
        );
    }

    // Expanded: show simple checklist
    return (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
            {sortedTodos.map((todo, index) => {
                const isFirst = index === 0;
                const isCompleted = todo.status === 'completed';
                const isInProgress = todo.status === 'in_progress';
                const checkbox = isCompleted ? '☑' : '☐';

                return (
                    <Box key={todo.id} marginLeft={2}>
                        {/* Tree connector for first item, space for others */}
                        <Text color="gray">{isFirst ? '⎿  ' : '   '}</Text>
                        <Text color={isCompleted ? 'green' : isInProgress ? 'yellow' : 'white'}>
                            {checkbox}{' '}
                        </Text>
                        <Text color={isCompleted ? 'gray' : 'white'} dimColor={isCompleted}>
                            {todo.content}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
