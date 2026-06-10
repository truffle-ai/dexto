import { TextEncoder } from 'node:util';
import type { ContentPart, InternalMessage } from './types.js';

export type ContentAuditSummary = {
    readonly totalParts: number;
    readonly textParts: number;
    readonly imageParts: number;
    readonly fileParts: number;
    readonly resourceParts: number;
    readonly uiResourceParts: number;
    readonly textLength: number;
    readonly textSha256?: string;
};

export type MessageAuditSummary = ContentAuditSummary & {
    readonly role: InternalMessage['role'];
    readonly contentPresent: boolean;
    readonly messageId?: string;
    readonly timestamp?: number;
};

export async function describeContentInputForAudit(
    content: string | readonly ContentPart[]
): Promise<ContentAuditSummary> {
    if (typeof content === 'string') {
        return describeContentPartsForAudit([{ type: 'text', text: content }]);
    }

    return describeContentPartsForAudit(content);
}

export async function describeContentPartsForAudit(
    content: readonly ContentPart[]
): Promise<ContentAuditSummary> {
    let textParts = 0;
    let imageParts = 0;
    let fileParts = 0;
    let resourceParts = 0;
    let uiResourceParts = 0;
    const textSegments: string[] = [];

    for (const part of content) {
        switch (part.type) {
            case 'text':
                textParts += 1;
                textSegments.push(part.text);
                break;
            case 'image':
                imageParts += 1;
                break;
            case 'file':
                fileParts += 1;
                break;
            case 'resource':
                resourceParts += 1;
                break;
            case 'ui-resource':
                uiResourceParts += 1;
                break;
        }
    }

    const textLength = textSegments.reduce((total, text) => total + text.length, 0);
    const textSha256 = textLength > 0 ? await sha256Hex(textSegments.join('\n')) : undefined;

    return {
        totalParts: content.length,
        textParts,
        imageParts,
        fileParts,
        resourceParts,
        uiResourceParts,
        textLength,
        ...(textSha256 !== undefined && { textSha256 }),
    };
}

export async function describeInternalMessageTailForAudit(
    messages: readonly InternalMessage[],
    limit: number
): Promise<MessageAuditSummary[]> {
    const tailStart = Math.max(0, messages.length - Math.max(0, limit));
    const tail = messages.slice(tailStart);

    return Promise.all(
        tail.map(async (message) => {
            const summary = Array.isArray(message.content)
                ? await describeContentPartsForAudit(message.content)
                : emptyContentAuditSummary();

            return {
                role: message.role,
                contentPresent: message.content !== null,
                ...summary,
                ...(message.id !== undefined && { messageId: message.id }),
                ...(message.timestamp !== undefined && { timestamp: message.timestamp }),
            };
        })
    );
}

function emptyContentAuditSummary(): ContentAuditSummary {
    return {
        totalParts: 0,
        textParts: 0,
        imageParts: 0,
        fileParts: 0,
        resourceParts: 0,
        uiResourceParts: 0,
        textLength: 0,
    };
}

async function sha256Hex(input: string): Promise<string | undefined> {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) {
        return undefined;
    }

    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
    );
}
