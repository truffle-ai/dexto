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
        <StyledBox title="Runtime Configuration" titleColor="cyan">
            {/* Config file path at the top */}
            {data.configFilePath && (
                <Box>
                    <Text color="gray">Agent config: </Text>
                    <Text color="blue">{data.configFilePath}</Text>
                </Box>
            )}

            <StyledSection title="LLM">
                <StyledRow label="Provider" value={data.provider} />
                <StyledRow label="Model" value={data.model} />
                {data.maxTokens !== null && (
                    <StyledRow label="Max Tokens" value={data.maxTokens.toString()} />
                )}
                {data.temperature !== null && (
                    <StyledRow label="Temperature" value={data.temperature.toString()} />
                )}
            </StyledSection>

            <StyledSection title="Tool Confirmation">
                <StyledRow label="Mode" value={data.toolConfirmationMode} />
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
                    <Text color="gray">No MCP servers configured</Text>
                )}
            </StyledSection>

            {data.promptsCount > 0 && (
                <StyledSection title="Prompts">
                    <Text color="gray">{data.promptsCount} prompt(s) configured</Text>
                </StyledSection>
            )}

            {data.pluginsEnabled.length > 0 && (
                <StyledSection title="Plugins">
                    {data.pluginsEnabled.map((plugin) => (
                        <Box key={plugin}>
                            <Text color="green">{plugin}</Text>
                        </Box>
                    ))}
                </StyledSection>
            )}

            {/* Footer note about CLI-populated fields */}
            <Box marginTop={1}>
                <Text color="gray" italic>
                    Note: Some fields (logs, database paths) are auto-populated by the CLI.
                </Text>
            </Box>
        </StyledBox>
    );
}
