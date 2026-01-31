/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import { useEffect, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName, getReasoningSupport, type DextoAgent } from '@dexto/core';
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
    planModeActive,
    isShellMode,
}: FooterProps) {
    const displayPath = cwd ? getDirectoryName(cwd) : '';
    const displayModelName = getModelDisplayName(modelName);
    const [contextLeft, setContextLeft] = useState<{
        percentLeft: number;
    } | null>(null);
    const [, setLlmTick] = useState(0);

    // Provider is session-scoped because /model can switch LLM per session.
    const llmConfig = sessionId ? agent.getCurrentLLMConfig(sessionId) : null;
    const provider = llmConfig?.provider ?? null;
    const providerLabel = provider ? getLLMProviderDisplayName(provider) : null;
    const reasoningPreset = llmConfig?.reasoning?.preset ?? 'auto';
    const reasoningSupport =
        provider && llmConfig ? getReasoningSupport(provider, llmConfig.model) : null;
    const showReasoningPreset = reasoningSupport ? reasoningSupport.capable : false;

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

        const bus = agent.agentEventBus;
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

        const handleEvent = (payload: { sessionId?: string; sessionIds?: string[] }) => {
            // Most session events include sessionId. llm:switched includes sessionIds[].
            if (payload.sessionId && payload.sessionId !== sessionId) return;
            if (payload.sessionIds && !payload.sessionIds.includes(sessionId)) return;
            refreshContext();
            // Force a re-render so the footer always reflects the current LLM config
            // (e.g. reasoning preset toggled via Tab).
            setLlmTick((prev) => prev + 1);
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
                <Box>
                    <Text color="cyan">{displayModelName}</Text>
                    {providerLabel && <Text color="gray"> ({providerLabel})</Text>}
                    {showReasoningPreset && (
                        <>
                            <Text color="gray"> · r:</Text>
                            <Text color="magentaBright">{reasoningPreset}</Text>
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
            {/* Shift+Tab cycles: Normal → Plan Mode → Accept All Edits → Normal */}
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
        </Box>
    );
}
