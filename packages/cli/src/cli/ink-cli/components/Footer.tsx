/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName, type DextoAgent } from '@dexto/core';
import { getLLMProviderDisplayName } from '../utils/llm-provider-display.js';

interface FooterProps {
    agent: DextoAgent;
    sessionId: string | null;
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    planModeActive?: boolean;
    /** Whether user is in shell command mode (input starts with !) */
    isShellMode?: boolean;
    /** Render a compact single-line footer (reduces flicker while overlays are open) */
    compact?: boolean;
}

function getDirectoryName(cwd: string): string {
    const base = path.basename(cwd);
    return base || cwd;
}

/**
 * Pure presentational component for footer status line
 */
export const Footer = memo(function Footer({
    agent,
    sessionId,
    modelName,
    cwd,
    branchName,
    autoApproveEdits,
    planModeActive,
    isShellMode,
    compact = false,
}: FooterProps) {
    const displayPath = cwd ? getDirectoryName(cwd) : '';
    const displayModelName = getModelDisplayName(modelName);
    const [contextLeft, setContextLeft] = useState<{
        percentLeft: number;
    } | null>(null);

    // Provider is session-scoped because /model can switch LLM per session.
    const providerLabel = useMemo(() => {
        if (!sessionId) return null;
        const provider = agent.getCurrentLLMConfig(sessionId).provider;
        return provider ? getLLMProviderDisplayName(provider) : null;
    }, [agent, sessionId]);

    useEffect(() => {
        if (!sessionId || compact) {
            setContextLeft(null);
            return;
        }

        let cancelled = false;
        let refreshId = 0;
        let scheduledTimeout: NodeJS.Timeout | null = null;

        const refreshContext = async () => {
            const requestId = ++refreshId;
            try {
                const stats = await agent.getContextStats(sessionId);
                if (cancelled || requestId !== refreshId) return;
                const percentLeft = Math.max(0, Math.min(100, 100 - stats.usagePercent));
                setContextLeft((prev) =>
                    prev?.percentLeft === percentLeft ? prev : { percentLeft }
                );
            } catch {
                if (!cancelled) {
                    setContextLeft(null);
                }
            }
        };

        const scheduleRefresh = () => {
            if (scheduledTimeout) return;
            scheduledTimeout = setTimeout(() => {
                scheduledTimeout = null;
                void refreshContext();
            }, 250);
        };

        scheduleRefresh();

        const controller = new AbortController();
        const { signal } = controller;
        const sessionEvents = [
            'llm:response',
            'context:compacted',
            'context:pruned',
            'context:cleared',
            'session:reset',
        ] as const;

        const handleEvent = (payload: { sessionId?: string }) => {
            if (payload.sessionId && payload.sessionId !== sessionId) return;
            scheduleRefresh();
        };

        for (const eventName of sessionEvents) {
            agent.on(eventName, handleEvent, { signal });
        }

        return () => {
            cancelled = true;
            if (scheduledTimeout) {
                clearTimeout(scheduledTimeout);
                scheduledTimeout = null;
            }
            controller.abort();
        };
    }, [agent, sessionId, compact]);

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
                <Box>
                    <Text color="cyan">{displayModelName}</Text>
                    {providerLabel && <Text color="gray"> ({providerLabel})</Text>}
                </Box>
            </Box>

            {/* Line 2: Context left */}
            {!compact && contextLeft && (
                <Box>
                    <Text color="gray">{contextLeft.percentLeft}% context left</Text>
                </Box>
            )}

            {/* Line 3: Mode indicators (left) */}
            {/* Shift+Tab cycles: Normal → Plan Mode → Accept All Edits → Normal */}
            {!compact && isShellMode && (
                <Box>
                    <Text color="yellow" bold>
                        !
                    </Text>
                    <Text color="gray"> for shell mode</Text>
                </Box>
            )}
            {!compact && planModeActive && !isShellMode && (
                <Box>
                    <Text color="magentaBright">plan mode</Text>
                    <Text color="gray"> (shift + tab to cycle)</Text>
                </Box>
            )}
            {!compact && autoApproveEdits && !planModeActive && !isShellMode && (
                <Box>
                    <Text color="yellowBright">accept edits</Text>
                    <Text color="gray"> (shift + tab to cycle)</Text>
                </Box>
            )}
        </Box>
    );
});
