/**
 * StyledBox - Base component for styled command output
 * Provides consistent box styling similar to Claude Code's output format
 */

import React from 'react';
import { Box, Text } from 'ink';

interface StyledBoxProps {
    title: string;
    titleColor?: string;
    children: React.ReactNode;
}

/**
 * Base styled box component with rounded border and title
 */
export function StyledBox({ title, titleColor = 'cyan', children }: StyledBoxProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                paddingY={0}
            >
                {/* Header */}
                <Box marginBottom={0}>
                    <Text bold color={titleColor}>
                        {title}
                    </Text>
                </Box>

                {/* Content */}
                {children}
            </Box>
        </Box>
    );
}

interface StyledSectionProps {
    title: string;
    icon?: string;
    children: React.ReactNode;
}

/**
 * Section within a styled box
 */
export function StyledSection({ title, icon, children }: StyledSectionProps) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>
                {icon && `${icon} `}
                {title}
            </Text>
            <Box flexDirection="column" marginLeft={2}>
                {children}
            </Box>
        </Box>
    );
}

interface StyledRowProps {
    label: string;
    value: string;
    valueColor?: string;
}

/**
 * Key-value row within a section
 */
export function StyledRow({ label, value, valueColor = 'cyan' }: StyledRowProps) {
    return (
        <Box>
            <Text dimColor>{label}: </Text>
            <Text color={valueColor}>{value}</Text>
        </Box>
    );
}

interface StyledListItemProps {
    icon?: string;
    text: string;
    isActive?: boolean;
    dimmed?: boolean;
}

/**
 * List item with optional icon and active state
 */
export function StyledListItem({ icon, text, isActive, dimmed }: StyledListItemProps) {
    // Build props object conditionally to avoid undefined with exactOptionalPropertyTypes
    const textProps: Record<string, unknown> = {};
    if (isActive) {
        textProps.color = 'green';
        textProps.bold = true;
    }
    if (dimmed) {
        textProps.dimColor = true;
    }

    return (
        <Box>
            {icon && <Text {...textProps}>{icon} </Text>}
            <Text {...textProps}>{text}</Text>
        </Box>
    );
}
