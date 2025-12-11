/**
 * StatsBox - Styled output for /stats command
 */

import React from 'react';
import type { StatsStyledData } from '../../../state/types.js';
import { StyledBox, StyledSection, StyledRow } from './StyledBox.js';

interface StatsBoxProps {
    data: StatsStyledData;
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
        </StyledBox>
    );
}
