/**
 * ContextStatsOverlay Component
 * Interactive overlay for viewing context window usage statistics
 * Features:
 * - Summary view with progress bar
 * - Detailed breakdown by category
 * - Per-tool token usage (expandable)
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';

interface ContextStatsOverlayProps {
    isVisible: boolean;
    onClose: () => void;
    agent: DextoAgent;
    sessionId: string;
}

export interface ContextStatsOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type ViewMode = 'summary' | 'tools';

interface ContextStats {
    estimatedTokens: number;
    actualTokens: number | null;
    maxContextTokens: number;
    usagePercent: number;
    messageCount: number;
    filteredMessageCount: number;
    prunedToolCount: number;
    hasSummary: boolean;
    model: string;
    modelDisplayName: string;
    breakdown: {
        systemPrompt: number;
        tools: {
            total: number;
            perTool: Array<{ name: string; tokens: number }>;
        };
        messages: number;
        outputBuffer: number;
    };
}

/**
 * Format token count for display (e.g., 1500 -> "1.5k")
 */
function formatTokens(tokens: number): string {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toLocaleString();
}

/**
 * Create a visual progress bar
 */
function createProgressBar(percent: number, width: number = 20): string {
    const clampedPercent = Math.min(percent, 100);
    const filledWidth = Math.round((clampedPercent / 100) * width);
    const emptyWidth = width - filledWidth;
    return '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
}

/**
 * Context stats overlay with tab navigation
 */
const ContextStatsOverlay = forwardRef<ContextStatsOverlayHandle, ContextStatsOverlayProps>(
    function ContextStatsOverlay({ isVisible, onClose, agent, sessionId }, ref) {
        const [stats, setStats] = useState<ContextStats | null>(null);
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [viewMode, setViewMode] = useState<ViewMode>('summary');
        const [toolScrollIndex, setToolScrollIndex] = useState(0);

        const MAX_VISIBLE_TOOLS = 10;

        // Fetch stats when overlay becomes visible
        useEffect(() => {
            if (!isVisible) {
                setStats(null);
                setError(null);
                setViewMode('summary');
                setToolScrollIndex(0);
                return;
            }

            let cancelled = false;
            setIsLoading(true);

            const fetchStats = async () => {
                try {
                    const contextStats = await agent.getContextStats(sessionId);
                    if (!cancelled) {
                        setStats(contextStats);
                        setIsLoading(false);
                    }
                } catch (err) {
                    if (!cancelled) {
                        setError(err instanceof Error ? err.message : String(err));
                        setIsLoading(false);
                    }
                }
            };

            fetchStats();

            return () => {
                cancelled = true;
            };
        }, [isVisible, agent, sessionId]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (_input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape or 'q' to close
                    if (key.escape || _input === 'q') {
                        onClose();
                        return true;
                    }

                    // Tab to switch views
                    if (key.tab) {
                        setViewMode((prev) => (prev === 'summary' ? 'tools' : 'summary'));
                        setToolScrollIndex(0);
                        return true;
                    }

                    // Arrow keys for scrolling in tools view
                    if (viewMode === 'tools' && stats) {
                        const toolCount = stats.breakdown.tools.perTool.length;
                        if (key.upArrow) {
                            setToolScrollIndex((prev) => Math.max(0, prev - 1));
                            return true;
                        }
                        if (key.downArrow) {
                            setToolScrollIndex((prev) =>
                                Math.min(Math.max(0, toolCount - MAX_VISIBLE_TOOLS), prev + 1)
                            );
                            return true;
                        }
                    }

                    return false;
                },
            }),
            [isVisible, onClose, viewMode, stats]
        );

        if (!isVisible) return null;

        // Loading state
        if (isLoading) {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="cyan"
                    paddingX={2}
                    paddingY={1}
                >
                    <Text color="cyan" bold>
                        📊 Context Usage
                    </Text>
                    <Text color="gray">Loading...</Text>
                </Box>
            );
        }

        // Error state
        if (error) {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="red"
                    paddingX={2}
                    paddingY={1}
                >
                    <Text color="red" bold>
                        ❌ Error
                    </Text>
                    <Text color="gray">{error}</Text>
                    <Box marginTop={1}>
                        <Text color="gray" dimColor>
                            Press Esc to close
                        </Text>
                    </Box>
                </Box>
            );
        }

        if (!stats) return null;

        // Calculate percentage helper
        const pct = (tokens: number): string => {
            const percent =
                stats.maxContextTokens > 0
                    ? ((tokens / stats.maxContextTokens) * 100).toFixed(1)
                    : '0.0';
            return `${percent}%`;
        };

        // Determine usage color
        let usageColor: string = 'green';
        if (stats.usagePercent > 80) usageColor = 'red';
        else if (stats.usagePercent > 60) usageColor = 'yellow';

        const progressBar = createProgressBar(stats.usagePercent);
        const tokenDisplay =
            stats.actualTokens !== null
                ? formatTokens(stats.actualTokens)
                : `~${formatTokens(stats.estimatedTokens)}`;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="cyan"
                paddingX={2}
                paddingY={1}
            >
                {/* Header */}
                <Box marginBottom={1}>
                    <Text color="cyan" bold>
                        📊 Context Usage
                    </Text>
                    <Text color="gray"> - {stats.modelDisplayName}</Text>
                </Box>

                {/* Progress bar */}
                <Box>
                    <Text color={usageColor}>{progressBar}</Text>
                    <Text color={usageColor}> {stats.usagePercent}%</Text>
                    {stats.usagePercent > 100 && <Text color="red"> ⚠️ OVERFLOW</Text>}
                </Box>

                {/* Token summary */}
                <Box marginBottom={1}>
                    <Text color="gray">
                        {tokenDisplay} / {formatTokens(stats.maxContextTokens)} tokens
                    </Text>
                    {stats.actualTokens === null && (
                        <Text color="gray" dimColor>
                            {' '}
                            (estimated)
                        </Text>
                    )}
                </Box>

                {/* Tab navigation */}
                <Box marginBottom={1}>
                    <Text
                        color={viewMode === 'summary' ? 'cyan' : 'gray'}
                        bold={viewMode === 'summary'}
                    >
                        [Summary]
                    </Text>
                    <Text color="gray"> </Text>
                    <Text
                        color={viewMode === 'tools' ? 'cyan' : 'gray'}
                        bold={viewMode === 'tools'}
                    >
                        [Tools ({stats.breakdown.tools.perTool.length})]
                    </Text>
                </Box>

                {/* Summary view */}
                {viewMode === 'summary' && (
                    <Box flexDirection="column">
                        <Text color="white">Breakdown:</Text>
                        <Text color="gray">
                            ├─ System prompt: {formatTokens(stats.breakdown.systemPrompt)} (
                            {pct(stats.breakdown.systemPrompt)})
                        </Text>
                        <Text color="gray">
                            ├─ Tools: {formatTokens(stats.breakdown.tools.total)} (
                            {pct(stats.breakdown.tools.total)})
                        </Text>
                        <Text color="gray">
                            ├─ Messages: {formatTokens(stats.breakdown.messages)} (
                            {pct(stats.breakdown.messages)})
                        </Text>
                        <Text color="gray">
                            └─ Output buffer: {formatTokens(stats.breakdown.outputBuffer)}{' '}
                            (reserved)
                        </Text>

                        <Box marginTop={1}>
                            <Text color="gray">
                                Messages: {stats.filteredMessageCount} visible ({stats.messageCount}{' '}
                                total)
                            </Text>
                        </Box>

                        {stats.prunedToolCount > 0 && (
                            <Text color="yellow">
                                🗑️ {stats.prunedToolCount} tool output(s) pruned
                            </Text>
                        )}

                        {stats.hasSummary && (
                            <Text color="blue">📦 Context has been compacted</Text>
                        )}

                        {stats.usagePercent > 100 && (
                            <Text color="yellow">
                                💡 Use /compact to manually compact, or send a message to trigger
                                auto-compaction
                            </Text>
                        )}
                    </Box>
                )}

                {/* Tools view */}
                {viewMode === 'tools' && (
                    <Box flexDirection="column">
                        <Text color="white">
                            🔧 Tool Token Usage ({formatTokens(stats.breakdown.tools.total)} total)
                        </Text>
                        <Box marginTop={1} flexDirection="column">
                            {stats.breakdown.tools.perTool.length === 0 ? (
                                <Text color="gray">No tools registered</Text>
                            ) : (
                                <>
                                    {/* Sort by tokens descending and slice for scrolling */}
                                    {[...stats.breakdown.tools.perTool]
                                        .sort((a, b) => b.tokens - a.tokens)
                                        .slice(toolScrollIndex, toolScrollIndex + MAX_VISIBLE_TOOLS)
                                        .map((tool, idx) => (
                                            <Text key={tool.name} color="gray">
                                                {idx === 0 && toolScrollIndex > 0 ? '↑ ' : '  '}
                                                <Text color="cyan">{tool.name}</Text>:{' '}
                                                {formatTokens(tool.tokens)} ({pct(tool.tokens)})
                                            </Text>
                                        ))}
                                    {toolScrollIndex + MAX_VISIBLE_TOOLS <
                                        stats.breakdown.tools.perTool.length && (
                                        <Text color="gray" dimColor>
                                            ↓{' '}
                                            {stats.breakdown.tools.perTool.length -
                                                toolScrollIndex -
                                                MAX_VISIBLE_TOOLS}{' '}
                                            more...
                                        </Text>
                                    )}
                                </>
                            )}
                        </Box>
                    </Box>
                )}

                {/* Footer with controls */}
                <Box marginTop={1}>
                    <Text color="gray" dimColor>
                        Tab: switch view | ↑↓: scroll | Esc: close
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default ContextStatsOverlay;
