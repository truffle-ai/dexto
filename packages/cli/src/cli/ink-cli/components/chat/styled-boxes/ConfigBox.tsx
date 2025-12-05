/**
 * ConfigBox - Styled output for /config command
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ConfigStyledData } from '../../../state/types.js';
import { StyledBox, StyledSection, StyledRow } from './StyledBox.js';

interface ConfigBoxProps {
    data: ConfigStyledData;
}

export function ConfigBox({ data }: ConfigBoxProps) {
    return (
        <StyledBox title="Configuration">
            <StyledSection title="LLM" icon="LLM">
                <StyledRow label="Provider" value={data.provider} />
                <StyledRow label="Model" value={data.model} />
                <StyledRow label="Router" value={data.router} />
            </StyledSection>

            <StyledSection title="Sessions">
                <StyledRow label="Max Sessions" value={data.maxSessions} />
                <StyledRow label="Session TTL" value={data.sessionTTL} />
            </StyledSection>

            <StyledSection title="MCP Servers">
                {data.mcpServers.length > 0 ? (
                    data.mcpServers.map((server) => (
                        <Box key={server}>
                            <Text color="cyan">{server}</Text>
                        </Box>
                    ))
                ) : (
                    <Text dimColor>No MCP servers configured</Text>
                )}
            </StyledSection>
        </StyledBox>
    );
}
