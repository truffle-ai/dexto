import React from 'react';
import { X, ArrowUp } from 'lucide-react';
import { Button } from './ui/button';
import type { QueuedMessage } from './hooks/useQueue';
import { isTextPart } from '../types';

interface QueuedMessagesDisplayProps {
    messages: QueuedMessage[];
    onEditMessage: (message: QueuedMessage) => void;
    onRemoveMessage: (messageId: string) => void;
}

/**
 * Displays queued messages with visual indicators and keyboard hints.
 */
export function QueuedMessagesDisplay({
    messages,
    onEditMessage,
    onRemoveMessage,
}: QueuedMessagesDisplayProps) {
    if (messages.length === 0) return null;

    // Extract text content from message
    const getMessageText = (message: QueuedMessage): string => {
        const textParts = message.content.filter(isTextPart).map((part) => part.text);
        return textParts.join(' ') || '[attachment]';
    };

    // Truncate text to max lines
    const truncateText = (text: string, maxLines: number = 2): string => {
        const lines = text.split('\n');
        if (lines.length <= maxLines) {
            return text.length > 100 ? text.slice(0, 100) + '...' : text;
        }
        return lines.slice(0, maxLines).join('\n') + '...';
    };

    return (
        <div className="px-4 pb-2">
            <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
                {/* Header */}
                <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-xs font-medium text-muted-foreground">
                        {messages.length} message{messages.length !== 1 ? 's' : ''} queued
                    </span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px]">
                            <ArrowUp className="h-2.5 w-2.5 inline" />
                        </kbd>
                        <span className="ml-1">to edit</span>
                    </div>
                </div>

                {/* Messages list */}
                <div className="space-y-1">
                    {messages.map((message, index) => (
                        <div
                            key={message.id}
                            className="group flex items-start gap-2 px-1 py-1 rounded hover:bg-muted/50 transition-colors"
                        >
                            {/* Arrow indicator */}
                            <span className="text-muted-foreground text-xs mt-0.5 select-none">
                                {index === messages.length - 1 ? '↳' : '│'}
                            </span>

                            {/* Message content */}
                            <button
                                onClick={() => onEditMessage(message)}
                                className="flex-1 text-left text-sm text-muted-foreground italic hover:text-foreground transition-colors truncate"
                                title="Click to edit"
                            >
                                {truncateText(getMessageText(message))}
                            </button>

                            {/* Remove button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onRemoveMessage(message.id)}
                                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Remove from queue"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
