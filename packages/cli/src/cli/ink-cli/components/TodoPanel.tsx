/**
 * TodoPanel Component
 *
 * Displays the current todo list for workflow tracking.
 * Shows todos with their status indicators (pending, in progress, completed).
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem, TodoStatus } from '../state/types.js';

interface TodoPanelProps {
    todos: TodoItem[];
}

/**
 * Get status indicator for a todo item
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
 * Get status label for a todo item
 */
function getStatusLabel(status: TodoStatus): string {
    switch (status) {
        case 'completed':
            return 'done';
        case 'in_progress':
            return 'working';
        case 'pending':
        default:
            return 'todo';
    }
}

/**
 * Individual todo item display
 */
function TodoItemRow({ todo }: { todo: TodoItem }) {
    const { icon, color } = getStatusIndicator(todo.status);
    const isCompleted = todo.status === 'completed';
    const isInProgress = todo.status === 'in_progress';

    return (
        <Box>
            <Text color={color}>{icon} </Text>
            <Text
                color={isCompleted ? 'gray' : isInProgress ? 'yellowBright' : 'white'}
                strikethrough={isCompleted}
            >
                {isInProgress ? todo.activeForm : todo.content}
            </Text>
            {isInProgress && (
                <Text color="gray" dimColor>
                    {' '}
                    ({getStatusLabel(todo.status)})
                </Text>
            )}
        </Box>
    );
}

/**
 * TodoPanel - Shows current todos for workflow tracking
 *
 * Design decisions:
 * - Only shown when there are todos to display
 * - Compact display that doesn't take too much vertical space
 * - Status indicators: ○ pending, ● in progress, ✓ completed
 * - In-progress items show activeForm (what's being worked on)
 * - Completed items are dimmed with strikethrough
 */
export function TodoPanel({ todos }: TodoPanelProps) {
    if (todos.length === 0) {
        return null;
    }

    // Sort todos by position
    const sortedTodos = [...todos].sort((a, b) => a.position - b.position);

    // Count by status
    const completed = todos.filter((t) => t.status === 'completed').length;
    const total = todos.length;

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginBottom={1}
        >
            {/* Header */}
            <Box marginBottom={0}>
                <Text bold color="cyan">
                    📋 Tasks{' '}
                </Text>
                <Text color="gray">
                    ({completed}/{total})
                </Text>
            </Box>

            {/* Todo items */}
            <Box flexDirection="column">
                {sortedTodos.map((todo) => (
                    <TodoItemRow key={todo.id} todo={todo} />
                ))}
            </Box>
        </Box>
    );
}
