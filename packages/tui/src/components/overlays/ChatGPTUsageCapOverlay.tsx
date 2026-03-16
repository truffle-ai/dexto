import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { CodexRateLimitSnapshot } from '@dexto/core';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { getChatGPTRateLimitHint } from '../../utils/chatgpt-rate-limit.js';

export interface ChatGPTUsageCapOverlayProps {
    isVisible: boolean;
    currentModelDisplayName: string;
    fallbackModelDisplayName: string;
    usedDefaultFallback: boolean;
    apiKeyConfigured: boolean;
    status: CodexRateLimitSnapshot | null;
    onConfirm: () => void;
    onClose: () => void;
}

export interface ChatGPTUsageCapOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

const ChatGPTUsageCapOverlay = forwardRef<
    ChatGPTUsageCapOverlayHandle,
    ChatGPTUsageCapOverlayProps
>(function ChatGPTUsageCapOverlay(
    {
        isVisible,
        currentModelDisplayName,
        fallbackModelDisplayName,
        usedDefaultFallback,
        apiKeyConfigured,
        status,
        onConfirm,
        onClose,
    },
    ref
) {
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) {
                    return false;
                }

                if (key.escape) {
                    onClose();
                    return true;
                }

                if (key.return) {
                    onConfirm();
                    return true;
                }

                return true;
            },
        }),
        [isVisible, onClose, onConfirm]
    );

    if (!isVisible) {
        return null;
    }

    const actionLabel = apiKeyConfigured
        ? `Switch this session to ${fallbackModelDisplayName} via OpenAI API key`
        : `Add an OpenAI API key and switch this session to ${fallbackModelDisplayName}`;

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
            marginTop={1}
        >
            <Box marginBottom={1}>
                <Text bold color="yellowBright">
                    ChatGPT usage cap reached
                </Text>
            </Box>

            {status && (
                <Box marginBottom={1}>
                    <Text color="gray">{getChatGPTRateLimitHint(status)}</Text>
                </Box>
            )}

            <Box flexDirection="column" marginBottom={1}>
                <Text color="gray">
                    {currentModelDisplayName} is currently running through ChatGPT Login.
                </Text>
                <Text>{actionLabel}</Text>
            </Box>

            {usedDefaultFallback && (
                <Box marginBottom={1}>
                    <Text color="gray">
                        The current ChatGPT model is not available through the OpenAI API path, so
                        Dexto will use {fallbackModelDisplayName} for this session.
                    </Text>
                </Box>
            )}

            <Box>
                <Text color="gray">Enter to continue • Esc to dismiss</Text>
            </Box>
        </Box>
    );
});

export default ChatGPTUsageCapOverlay;
