/**
 * StatsBox - Styled output for /stats command
 */

import React from 'react';
import type { StatsStyledData } from '../../../state/types.js';
import { StyledBox, StyledSection, StyledRow } from './StyledBox.js';

interface StatsBoxProps {
    data: StatsStyledData;
}

/**
 * Format a number with K/M suffixes for compact display
 */
function formatTokenCount(count: number): string {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toString();
}

/**
 * Format cost in USD with appropriate precision
 */
function formatCost(cost: number): string {
    if (cost < 0.01) {
        return `$${cost.toFixed(4)}`;
    }
    if (cost < 1) {
        return `$${cost.toFixed(3)}`;
    }
    return `$${cost.toFixed(2)}`;
}

export function StatsBox({ data }: StatsBoxProps) {
    return (
        <StyledBox title="System Statistics">
            <StyledSection title="Sessions">
                <StyledRow label="Total Sessions" value={data.sessions.total.toString()} />
                <StyledRow label="In Memory" value={data.sessions.inMemory.toString()} />
                <StyledRow label="Max Allowed" value={data.sessions.maxAllowed.toString()} />
            </StyledSection>

            <StyledSection title="MCP Servers">
                <StyledRow
                    label="Connected"
                    value={data.mcp.connected.toString()}
                    valueColor="green"
                />
                {data.mcp.failed > 0 && (
                    <StyledRow label="Failed" value={data.mcp.failed.toString()} valueColor="red" />
                )}
                <StyledRow label="Available Tools" value={data.mcp.toolCount.toString()} />
            </StyledSection>

            {data.tokenUsage && (
                <StyledSection title="Token Usage (This Session)">
                    <StyledRow
                        label="Input"
                        value={formatTokenCount(data.tokenUsage.inputTokens)}
                    />
                    <StyledRow
                        label="Output"
                        value={formatTokenCount(data.tokenUsage.outputTokens)}
                    />
                    {data.tokenUsage.reasoningTokens > 0 && (
                        <StyledRow
                            label="Reasoning"
                            value={formatTokenCount(data.tokenUsage.reasoningTokens)}
                        />
                    )}
                    {data.tokenUsage.cacheReadTokens > 0 && (
                        <StyledRow
                            label="Cache Read"
                            value={formatTokenCount(data.tokenUsage.cacheReadTokens)}
                            valueColor="cyan"
                        />
                    )}
                    {data.tokenUsage.cacheWriteTokens > 0 && (
                        <StyledRow
                            label="Cache Write"
                            value={formatTokenCount(data.tokenUsage.cacheWriteTokens)}
                            valueColor="orange"
                        />
                    )}
                    <StyledRow
                        label="Total"
                        value={formatTokenCount(data.tokenUsage.totalTokens)}
                        valueColor="blue"
                    />
                    {data.estimatedCost !== undefined && (
                        <StyledRow
                            label="Est. Cost"
                            value={formatCost(data.estimatedCost)}
                            valueColor="green"
                        />
                    )}
                </StyledSection>
            )}
        </StyledBox>
    );
}
