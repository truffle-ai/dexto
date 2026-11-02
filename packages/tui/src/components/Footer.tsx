/**
 * Footer Component
 * Status line at the bottom showing CWD, branch, and model info.
 */

import { useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName } from '@dexto/llm';
import type { CodexRateLimitSnapshot } from '@dexto/core';
import { getLLMProviderDisplayName } from '../utils/llm-provider-display.js';
import { resolveChatGPTRateLimitHint } from '../utils/chatgpt-rate-limit.js';
import { displayedReasoningVariant } from '../utils/reasoning-variant.js';
import type { TuiAgentBackend } from '../agent-backend.js';
import { useContextStats } from '../hooks/useContextStats.js';
import { useDextoCreditBalance } from '../hooks/useDextoCredits.js';
import { tone } from '../signal/index.js';

interface FooterProps {
    agent: TuiAgentBackend;
    sessionId: string | null;
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    bypassPermissions?: boolean;
    planModeActive?: boolean;
    /** Whether user is in shell command mode (input starts with !) */
    isShellMode?: boolean;
    chatgptRateLimitStatus?: CodexRateLimitSnapshot | null;
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
    chatgptRateLimitStatus,
}: FooterProps) {
    const displayPath = cwd ? path.basename(cwd) || cwd : '';
    const displayModelName = getModelDisplayName(modelName);
    const [, setLlmTick] = useState(0);

    // Provider is session-scoped because /model can switch LLM per session.
    const llmConfig = sessionId ? agent.getCurrentLLMConfig(sessionId) : null;
    const provider = llmConfig?.provider ?? null;
    const providerLabel = provider ? getLLMProviderDisplayName(provider, llmConfig?.baseURL) : null;
    const reasoningVariant = displayedReasoningVariant(llmConfig);
    const chatGPTRateLimitHint = resolveChatGPTRateLimitHint(
        llmConfig,
        chatgptRateLimitStatus,
        'full'
    );
    const chatGPTRateLimitColor = chatgptRateLimitStatus?.exceeded
        ? tone('del')
        : (chatgptRateLimitStatus?.usedPercent ?? 0) >= 90
          ? tone('amber')
          : tone('amberDim');

    const contextUsage = useContextStats(agent, sessionId, () => setLlmTick((prev) => prev + 1));
    const contextLeft = contextUsage
        ? { percentLeft: Math.max(0, Math.min(100, 100 - contextUsage.usagePercent)) }
        : null;

    // Dexto models spend the organization's credits: show what's left, refreshed after each reply.
    const creditBalance = useDextoCreditBalance(agent, sessionId, provider === 'dexto-nova');

    // Shell mode changes the path color to yellow as indicator
    const pathColor = isShellMode ? tone('amberDim') : tone('fg');

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Line 1: CWD (left) | Model name (right) */}
            <Box flexDirection="row" justifyContent="space-between">
                <Box>
                    <Text color={pathColor}>{displayPath}</Text>
                    {branchName && <Text color={tone('dim')}> ({branchName})</Text>}
                </Box>
                <Box>
                    <Text color={tone('teal')}>{displayModelName}</Text>
                    {providerLabel && <Text color={tone('dim')}> ({providerLabel})</Text>}
                    {reasoningVariant !== null && (
                        <>
                            <Text color={tone('dim')}> · r:</Text>
                            <Text color={tone('cloudDim')}>{reasoningVariant}</Text>
                        </>
                    )}
                </Box>
            </Box>

            {/* Line 2: Context left */}
            {contextLeft && (
                <Box>
                    <Text color={tone('dim')}>{contextLeft.percentLeft}% context left</Text>
                </Box>
            )}

            {creditBalance !== null && (
                <Box>
                    <Text color={tone('dim')}>${creditBalance.toFixed(2)} credits</Text>
                </Box>
            )}

            {chatGPTRateLimitHint && (
                <Box>
                    <Text color={chatGPTRateLimitColor}>{chatGPTRateLimitHint}</Text>
                </Box>
            )}

            <Box>
                <Text color={tone('dim')}>
                    approvals: {agent.getEffectiveConfig(sessionId ?? undefined).permissions.mode}
                </Text>
            </Box>

            {/* Line 3: Mode indicators (left) */}
            {/* Shift+Tab cycles: Normal → Plan Mode → Accept All Edits → Bypass Permissions → Normal */}
            {isShellMode && (
                <Box>
                    <Text color={tone('amberDim')} bold>
                        !
                    </Text>
                    <Text color={tone('dim')}> for shell mode</Text>
                </Box>
            )}
            {planModeActive && !isShellMode && (
                <Box>
                    <Text color={tone('cloudDim')}>plan mode</Text>
                    <Text color={tone('dim')}> (shift + tab to cycle)</Text>
                </Box>
            )}
            {autoApproveEdits && !planModeActive && !isShellMode && (
                <Box>
                    <Text color={tone('amber')}>accept edits</Text>
                    <Text color={tone('dim')}> (shift + tab to cycle)</Text>
                </Box>
            )}
            {bypassPermissions && !planModeActive && !autoApproveEdits && !isShellMode && (
                <Box>
                    <Text color={tone('dim')}>auto-approve (session)</Text>
                    <Text color={tone('dim')}> (shift + tab to cycle)</Text>
                </Box>
            )}
        </Box>
    );
}
