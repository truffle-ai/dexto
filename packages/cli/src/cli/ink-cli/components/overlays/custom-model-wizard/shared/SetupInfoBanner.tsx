/**
 * SetupInfoBanner Component
 * Displays setup information for providers that need special configuration.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface SetupInfoBannerProps {
    /** Banner title */
    title: string;
    /** Description text */
    description: string;
    /** Optional documentation URL */
    docsUrl?: string | undefined;
}

/**
 * Displays a setup info banner with title, description, and optional docs link.
 * Used for providers like Bedrock that require special configuration.
 */
export function SetupInfoBanner({
    title,
    description,
    docsUrl,
}: SetupInfoBannerProps): React.ReactElement {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="blue">ℹ {title}</Text>
            <Text color="gray">{description}</Text>
            {docsUrl && <Text color="gray">Setup guide: {docsUrl}</Text>}
        </Box>
    );
}

export default SetupInfoBanner;
