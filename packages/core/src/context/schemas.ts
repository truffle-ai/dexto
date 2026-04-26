import { z } from 'zod';
import type { ContentPart, InternalMessage } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentPart(value: unknown): value is ContentPart {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return false;
    }

    switch (value.type) {
        case 'text':
            return typeof value.text === 'string';
        case 'image':
            return 'image' in value;
        case 'file':
            return 'data' in value && typeof value.mimeType === 'string';
        case 'resource':
            return (
                typeof value.uri === 'string' &&
                typeof value.name === 'string' &&
                typeof value.mimeType === 'string' &&
                ['text', 'image', 'audio', 'video', 'binary'].includes(String(value.kind))
            );
        case 'ui-resource':
            return typeof value.uri === 'string' && typeof value.mimeType === 'string';
        default:
            return false;
    }
}

function isContentParts(value: unknown): value is ContentPart[] {
    return Array.isArray(value) && value.every(isContentPart);
}

export const ContentPartSchema: z.ZodType<ContentPart> = z.custom<ContentPart>(isContentPart, {
    message: 'Expected a Dexto content part.',
});

export const InternalMessageSchema: z.ZodType<InternalMessage> = z.custom<InternalMessage>(
    (value) => {
        if (!isRecord(value)) {
            return false;
        }

        switch (value.role) {
            case 'system':
            case 'user':
                return isContentParts(value.content);
            case 'assistant':
                return value.content === null || isContentParts(value.content);
            case 'tool':
                return (
                    isContentParts(value.content) &&
                    typeof value.toolCallId === 'string' &&
                    typeof value.name === 'string'
                );
            default:
                return false;
        }
    },
    { message: 'Expected a Dexto internal message.' }
);
