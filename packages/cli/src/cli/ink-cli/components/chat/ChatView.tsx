/**
 * ChatView Component
 * Main chat display area combining header and messages
 */

import React from 'react';
import { Box } from 'ink';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import type { Message, StartupInfo } from '../../state/types.js';

interface ChatViewProps {
    messages: Message[];
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
    startupInfo: StartupInfo;
}

/**
 * Pure presentational component for chat area
 * Combines header and message list
 */
export function ChatView({
    messages,
    modelName,
    sessionId,
    hasActiveSession,
    startupInfo,
}: ChatViewProps) {
    return (
        <Box flexDirection="column" flexGrow={1}>
            <Header
                modelName={modelName}
                sessionId={sessionId}
                hasActiveSession={hasActiveSession}
                startupInfo={startupInfo}
            />
            <MessageList messages={messages} />
        </Box>
    );
}
