/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import React, { useEffect, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName, type DextoAgent } from '@dexto/core';

interface FooterProps {
    agent: DextoAgent;
    sessionId: string | null;
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    /** Whether user is in shell command mode (input starts with !) */
    isShellMode?: boolean;
}

function getDirectoryName(cwd: string): string {
    const base = path.basename(cwd);
    return base || cwd;
}

/**
 * Pure presentational component for footer status line
 */
export function Footer({
    agent,
    sessionId,
    modelName,
    cwd,
    branchName,
    autoApproveEdits,
    isShellMode,
}: FooterProps) {
    const displayPath = cwd ? getDirectoryName(cwd) : '';
    const displayModelName = getModelDisplayName(modelName);
    const [contextLeft, setContextLeft] = useState<{
        percentLeft: number;
        isEstimated: boolean;
    } | null>(null);

    useEffect(() => {
        if (!sessionId) {
            setContextLeft(null);
            return;
        }

        let cancelled = false;
        let refreshId = 0;

        const refreshContext = async () => {
            const requestId = ++refreshId;
            try {
                const stats = await agent.getContextStats(sessionId);
                if (cancelled || requestId !== refreshId) return;
                const percentLeft = Math.max(0, Math.min(100, 100 - stats.usagePercent));
                setContextLeft({
                    percentLeft,
                    isEstimated: stats.calculationBasis?.method !== 'actuals',
                });
            } catch {
                if (!cancelled) {
                    setContextLeft(null);
                }
            }
        };

        refreshContext();

        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;
        const sessionEvents = [
            'llm:response',
            'context:compacted',
            'context:pruned',
            'context:cleared',
            'message:dequeued',
            'session:reset',
        ] as const;

        const handleEvent = (payload: { sessionId?: string }) => {
            if (payload.sessionId && payload.sessionId !== sessionId) return;
            refreshContext();
        };

        for (const eventName of sessionEvents) {
            bus.on(eventName, handleEvent, { signal });
        }

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, sessionId]);

    // Shell mode changes the path color to yellow as indicator
    const pathColor = isShellMode ? 'yellow' : 'blue';

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Line 1: CWD (left) | Model name (right) */}
            <Box flexDirection="row" justifyContent="space-between">
                <Box>
                    <Text color={pathColor}>{displayPath}</Text>
                    {branchName && <Text color="gray"> ({branchName})</Text>}
                </Box>
                <Text color="cyan">{displayModelName}</Text>
            </Box>

            {/* Line 2: Context left */}
            {contextLeft && (
                <Box>
                    <Text color="gray">
                        {contextLeft.isEstimated ? '~' : ''}
                        {contextLeft.percentLeft}% context left
                    </Text>
                </Box>
            )}

            {/* Line 3: Mode indicators (left) */}
            {isShellMode && (
                <Box>
                    <Text color="yellow" bold>
                        !
                    </Text>
                    <Text color="gray"> for shell mode</Text>
                </Box>
            )}
            {autoApproveEdits && !isShellMode && (
                <Box>
                    <Text color="yellowBright">accept edits</Text>
                    <Text color="gray"> (shift + tab to toggle)</Text>
                </Box>
            )}
        </Box>
    );
}
