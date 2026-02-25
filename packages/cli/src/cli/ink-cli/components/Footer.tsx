/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import { useEffect, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName, getReasoningProfile, type DextoAgent } from '@dexto/core';
import { getLLMProviderDisplayName } from '../utils/llm-provider-display.js';

interface FooterProps {
    agent: DextoAgent;
    sessionId: string | null;
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    bypassPermissions?: boolean;
    planModeActive?: boolean;
    /** Whether user is in shell command mode (input starts with !) */
    isShellMode?: boolean;
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
    bypassPermissions,
    planModeActive,
    isShellMode,
}: FooterProps) {
    const displayPath = cwd ? path.basename(cwd) || cwd : '';
    const displayModelName = getModelDisplayName(modelName);
    const [contextLeft, setContextLeft] = useState<{
        percentLeft: number;
    } | null>(null);
    const [, setLlmTick] = useState(0);

    // Provider is session-scoped because /model can switch LLM per session.
    const llmConfig = sessionId ? agent.getCurrentLLMConfig(sessionId) : null;
    const provider = llmConfig?.provider ?? null;
    const providerLabel = provider ? getLLMProviderDisplayName(provider) : null;
    const reasoningProfile =
        provider && llmConfig ? getReasoningProfile(provider, llmConfig.model) : null;
    const reasoningVariant =
        llmConfig?.reasoning?.variant ?? reasoningProfile?.defaultVariant ?? undefined;
    const showReasoningVariant =
        reasoningProfile?.capable === true && typeof reasoningVariant === 'string';

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
                });
            } catch {
                if (!cancelled) {
                    setContextLeft(null);
                }
            }
        };

        refreshContext();

        const controller = new AbortController();
        const { signal } = controller;
        const sessionEvents = [
            'llm:response',
            'llm:switched',
            'context:compacted',
            'context:pruned',
            'context:cleared',
            'message:dequeued',
            'session:reset',
        ] as const;

        const handleEvent = (payload: { sessionId?: string }) => {
            // Most session events include sessionId.
            if (payload.sessionId && payload.sessionId !== sessionId) return;
            refreshContext();
        };

        const handleLlmSwitched = (payload: { sessionIds?: string[] }) => {
            // llm:switched includes sessionIds[].
            if (payload.sessionIds && !payload.sessionIds.includes(sessionId)) return;
            refreshContext();
            // Force a re-render so the footer always reflects current LLM config
            // (e.g. reasoning variant toggled via Tab).
            setLlmTick((prev) => prev + 1);
        };

        for (const eventName of sessionEvents) {
            if (eventName === 'llm:switched') {
                agent.on(eventName, handleLlmSwitched, { signal });
            } else {
                agent.on(eventName, handleEvent, { signal });
            }
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
                <Box>
                    <Text color="cyan">{displayModelName}</Text>
                    {providerLabel && <Text color="gray"> ({providerLabel})</Text>}
                    {showReasoningVariant && (
                        <>
                            <Text color="gray"> · r:</Text>
                            <Text color="magentaBright">{reasoningVariant}</Text>
                        </>
                    )}
                </Box>
            </Box>

            {/* Line 2: Context left */}
            {contextLeft && (
                <Box>
                    <Text color="gray">{contextLeft.percentLeft}% context left</Text>
                </Box>
            )}

            {/* Line 3: Mode indicators (left) */}
            {/* Shift+Tab cycles: Normal → Plan Mode → Accept All Edits → Bypass Permissions → Normal */}
            {isShellMode && (
                <Box>
                    <Text color="yellow" bold>
                        !
                    </Text>
                    <Text color="gray"> for shell mode</Text>
                </Box>
            )}
            {planModeActive && !isShellMode && (
                <Box>
                    <Text color="magentaBright">plan mode</Text>
                    <Text color="gray"> (shift + tab to cycle)</Text>
                </Box>
            )}
            {autoApproveEdits && !planModeActive && !isShellMode && (
                <Box>
                    <Text color="yellowBright">accept edits</Text>
                    <Text color="gray"> (shift + tab to cycle)</Text>
                </Box>
            )}
            {bypassPermissions && !planModeActive && !autoApproveEdits && !isShellMode && (
                <Box>
                    <Text color="redBright" bold>
                        bypass permissions
                    </Text>
                    <Text color="gray"> (shift + tab to cycle)</Text>
                </Box>
            )}
        </Box>
    );
}
