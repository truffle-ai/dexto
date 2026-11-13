/**
 * ProviderSelector Component
 * Renders the provider selection screen with navigation.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { CustomModelProvider } from '@dexto/agent-management';
import { getProviderLabel, getAvailableProviders } from '../provider-config.js';
import { tone } from '../../../../signal/index.js';

interface ProviderSelectorProps {
    /** Currently highlighted provider index */
    selectedIndex: number;
    /** Whether we're editing an existing model */
    isEditing: boolean;
}

/**
 * Renders a list of available providers with the current selection highlighted.
 */
export function ProviderSelector({
    selectedIndex,
    isEditing,
}: ProviderSelectorProps): React.ReactElement {
    const providers = getAvailableProviders();

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={tone('add')}
            paddingX={1}
            marginTop={1}
        >
            <Box marginBottom={1}>
                <Text bold color={tone('add')}>
                    {isEditing ? 'Edit Custom Model' : 'Add Custom Model'}
                </Text>
            </Box>

            <Text bold>Select Provider:</Text>

            <Box flexDirection="column" marginTop={1}>
                {providers.map((provider, index) => (
                    <Box key={provider}>
                        <Text
                            color={index === selectedIndex ? tone('teal') : tone('dim')}
                            bold={index === selectedIndex}
                        >
                            {index === selectedIndex ? '❯ ' : '  '}
                            {getProviderLabel(provider)}
                        </Text>
                    </Box>
                ))}
            </Box>

            <Box marginTop={1}>
                <Text color={tone('dim')}>↑↓ navigate • Enter select • Esc cancel</Text>
            </Box>
        </Box>
    );
}

export default ProviderSelector;
