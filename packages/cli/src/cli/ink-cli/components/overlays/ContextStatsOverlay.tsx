/**
 * ContextStatsOverlay Component
 * Interactive overlay for viewing context window usage statistics
 * Features:
 * - Navigate with arrow keys to highlight items
 * - Press Enter to expand/collapse sections (e.g., Tools)
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

interface ContextStats {
    estimatedTokens: number;
    actualTokens: number | null;
    maxContextTokens: number;
    usagePercent: number;
    messageCount: number;
    filteredMessageCount: number;
    prunedToolCount: number;
    hasSummary: boolean;
    compactionCount: number;
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

// Breakdown items that can be selected
type BreakdownItem = 'systemPrompt' | 'tools' | 'messages' | 'outputBuffer';
const BREAKDOWN_ITEMS: BreakdownItem[] = ['systemPrompt', 'tools', 'messages', 'outputBuffer'];

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
 * Context stats overlay with selectable breakdown items
 */
const ContextStatsOverlay = forwardRef<ContextStatsOverlayHandle, ContextStatsOverlayProps>(
    function ContextStatsOverlay({ isVisible, onClose, agent, sessionId }, ref) {
        const [stats, setStats] = useState<ContextStats | null>(null);
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [expandedSections, setExpandedSections] = useState<Set<BreakdownItem>>(new Set());

        // Fetch stats when overlay becomes visible
        useEffect(() => {
            if (!isVisible) {
                setStats(null);
                setError(null);
                setSelectedIndex(0);
                setExpandedSections(new Set());
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

                    // Arrow keys for navigation
                    if (key.upArrow) {
                        setSelectedIndex((prev) => Math.max(0, prev - 1));
                        return true;
                    }
                    if (key.downArrow) {
                        setSelectedIndex((prev) => Math.min(BREAKDOWN_ITEMS.length - 1, prev + 1));
                        return true;
                    }

                    // Enter to expand/collapse
                    if (key.return) {
                        const item = BREAKDOWN_ITEMS[selectedIndex];
                        // Only tools is expandable for now
                        if (item === 'tools') {
                            setExpandedSections((prev) => {
                                const next = new Set(prev);
                                if (next.has(item)) {
                                    next.delete(item);
                                } else {
                                    next.add(item);
                                }
                                return next;
                            });
                            return true;
                        }
                    }

                    return false;
                },
            }),
            [isVisible, onClose, selectedIndex]
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

        const isToolsExpanded = expandedSections.has('tools');

        // Helper to render a breakdown row
        const renderRow = (
            index: number,
            item: BreakdownItem,
            label: string,
            tokens: number,
            isLast: boolean,
            expandable?: boolean
        ) => {
            const isSelected = selectedIndex === index;
            const prefix = isLast ? '└─' : '├─';
            const expandIcon = expandable ? (isToolsExpanded ? '▼' : '▶') : ' ';

            return (
                <Text key={item} color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {prefix} {expandIcon} {label}: {formatTokens(tokens)} ({pct(tokens)})
                    {isSelected && expandable && (
                        <Text color="gray" dimColor>
                            {' '}
                            (Enter to {isToolsExpanded ? 'collapse' : 'expand'})
                        </Text>
                    )}
                </Text>
            );
        };

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

                {/* Breakdown */}
                <Box flexDirection="column">
                    <Text color="white">Breakdown:</Text>
                    {renderRow(
                        0,
                        'systemPrompt',
                        'System prompt',
                        stats.breakdown.systemPrompt,
                        false
                    )}
                    {renderRow(
                        1,
                        'tools',
                        `Tools (${stats.breakdown.tools.perTool.length})`,
                        stats.breakdown.tools.total,
                        false,
                        true
                    )}

                    {/* Expanded tools list */}
                    {isToolsExpanded && (
                        <Box flexDirection="column" marginLeft={4}>
                            {stats.breakdown.tools.perTool.length === 0 ? (
                                <Text color="gray" dimColor>
                                    No tools registered
                                </Text>
                            ) : (
                                [...stats.breakdown.tools.perTool]
                                    .sort((a, b) => b.tokens - a.tokens)
                                    .map((tool, idx, arr) => (
                                        <Text key={tool.name} color="gray" dimColor>
                                            {idx === arr.length - 1 ? '└─' : '├─'}{' '}
                                            <Text color="cyan" dimColor>
                                                {tool.name}
                                            </Text>
                                            : {formatTokens(tool.tokens)} ({pct(tool.tokens)})
                                        </Text>
                                    ))
                            )}
                        </Box>
                    )}

                    {renderRow(2, 'messages', 'Messages', stats.breakdown.messages, false)}
                    {renderRow(
                        3,
                        'outputBuffer',
                        'Output buffer (reserved)',
                        stats.breakdown.outputBuffer,
                        true
                    )}
                </Box>

                {/* Additional stats */}
                <Box marginTop={1} flexDirection="column">
                    <Text color="gray">
                        Messages: {stats.filteredMessageCount} visible ({stats.messageCount} total)
                    </Text>

                    {stats.prunedToolCount > 0 && (
                        <Text color="yellow">🗑️ {stats.prunedToolCount} tool output(s) pruned</Text>
                    )}

                    {stats.compactionCount > 0 && (
                        <Text color="blue">
                            📦 Compacted {stats.compactionCount} time
                            {stats.compactionCount > 1 ? 's' : ''}
                        </Text>
                    )}

                    {stats.usagePercent > 100 && (
                        <Text color="yellow">
                            💡 Use /compact to manually compact, or send a message to trigger
                            auto-compaction
                        </Text>
                    )}
                </Box>

                {/* Footer with controls */}
                <Box marginTop={1}>
                    <Text color="gray" dimColor>
                        ↑↓: navigate | Enter: expand/collapse | Esc: close
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default ContextStatsOverlay;
