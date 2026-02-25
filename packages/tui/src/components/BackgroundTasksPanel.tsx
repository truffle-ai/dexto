/**
 * BackgroundTasksPanel Component
 *
 * Displays background task status in a compact table.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface BackgroundTaskItem {
    taskId: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    description?: string;
}

interface BackgroundTasksPanelProps {
    tasks: BackgroundTaskItem[];
    isExpanded: boolean;
    isProcessing?: boolean;
}

function padText(value: string, width: number): string {
    if (value.length >= width) return value.slice(0, width - 1) + '…';
    return value.padEnd(width, ' ');
}

function formatStatus(status: BackgroundTaskItem['status']): string {
    switch (status) {
        case 'running':
            return 'running';
        case 'completed':
            return 'done';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
        default:
            return status;
    }
}

export function BackgroundTasksPanel({
    tasks,
    isExpanded,
    isProcessing = false,
}: BackgroundTasksPanelProps) {
    if (!isExpanded) return null;

    const sortedTasks = [...tasks].sort((a, b) => {
        if (a.status === b.status) return 0;
        if (a.status === 'running') return -1;
        if (b.status === 'running') return 1;
        return a.status.localeCompare(b.status);
    });

    const runningCount = tasks.filter((task) => task.status === 'running').length;
    const totalCount = tasks.length;

    const headerText = `🧵 Background Tasks (${runningCount}/${totalCount} running)`;

    if (totalCount === 0) {
        return (
            <Box
                flexDirection="column"
                borderStyle={isProcessing ? undefined : 'round'}
                borderColor="gray"
                paddingX={1}
                marginX={1}
                marginBottom={1}
            >
                <Text bold color="cyan">
                    {headerText}
                </Text>
                <Text color="gray" dimColor>
                    No background tasks
                </Text>
            </Box>
        );
    }

    const statusWidth = 10;
    const idWidth = 14;
    const descWidth = 48;

    return (
        <Box
            flexDirection="column"
            borderStyle={isProcessing ? undefined : 'round'}
            borderColor="gray"
            paddingX={1}
            marginX={1}
            marginBottom={1}
        >
            <Box>
                <Text bold color="cyan">
                    {headerText}
                </Text>
                <Text color="gray" dimColor>
                    {' '}
                    · ctrl+b to hide bg tasks
                </Text>
            </Box>
            <Box>
                <Text color="gray">
                    {padText('status', statusWidth)}
                    {padText('task id', idWidth)}
                    {padText('description', descWidth)}
                </Text>
            </Box>
            {sortedTasks.map((task) => {
                const status = formatStatus(task.status);
                const desc = task.description ?? '';
                return (
                    <Box key={task.taskId}>
                        <Text color={task.status === 'running' ? 'yellow' : 'gray'}>
                            {padText(status, statusWidth)}
                            {padText(task.taskId, idWidth)}
                            {padText(desc, descWidth)}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
