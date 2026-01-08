/**
 * Error Boundary Component
 * Catches and displays errors in the component tree
 */

import React from 'react';
import { Box, Text } from 'ink';
import { logger } from '@dexto/core';

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        logger.error(`Error in ErrorBoundary: ${error.message}`, {
            error,
            componentStack: errorInfo.componentStack,
        });
    }

    override render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
                    <Text color="red" bold>
                        ❌ CLI Error
                    </Text>
                    <Text color="red">{this.state.error?.message || 'Unknown error'}</Text>
                    <Text color="yellowBright">Press Ctrl+C to exit</Text>
                </Box>
            );
        }

        return this.props.children;
    }
}
