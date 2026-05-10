import type { ContentPart, FilePart, ImagePart, InternalMessage, TextPart } from './types.js';

function cloneBinaryData(
    data: ImagePart['image'] | FilePart['data']
): ImagePart['image'] | FilePart['data'] {
    if (typeof data === 'string') return data;
    if (data instanceof URL) return new URL(data.href);
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return Buffer.from(data);
    return new Uint8Array(data);
}

function cloneImagePart(part: ImagePart): ImagePart {
    const cloned: ImagePart = {
        type: 'image',
        image: cloneBinaryData(part.image),
    };
    if (part.mimeType) {
        cloned.mimeType = part.mimeType;
    }
    return cloned;
}

function cloneFilePart(part: FilePart): FilePart {
    const cloned: FilePart = {
        type: 'file',
        data: cloneBinaryData(part.data),
        mimeType: part.mimeType,
    };
    if (part.filename) {
        cloned.filename = part.filename;
    }
    return cloned;
}

export function cloneContentPart(part: ContentPart): ContentPart {
    switch (part.type) {
        case 'text':
            return { type: 'text', text: part.text };
        case 'image':
            return cloneImagePart(part);
        case 'file':
            return cloneFilePart(part);
        case 'resource':
            return {
                type: 'resource',
                uri: part.uri,
                name: part.name,
                mimeType: part.mimeType,
                kind: part.kind,
                ...(part.size !== undefined ? { size: part.size } : {}),
                ...(part.metadata !== undefined
                    ? { metadata: structuredClone(part.metadata) }
                    : {}),
            };
        case 'ui-resource':
            return {
                type: 'ui-resource',
                uri: part.uri,
                mimeType: part.mimeType,
                ...(part.content !== undefined ? { content: part.content } : {}),
                ...(part.blob !== undefined ? { blob: part.blob } : {}),
                ...(part.metadata !== undefined
                    ? { metadata: structuredClone(part.metadata) }
                    : {}),
            };
    }
}

export function cloneContentParts(content: ContentPart[]): ContentPart[] {
    return content.map((part) => cloneContentPart(part));
}

export function clonePromptContentPart(
    part: TextPart | ImagePart | FilePart
): TextPart | ImagePart | FilePart {
    switch (part.type) {
        case 'text':
            return { type: 'text', text: part.text };
        case 'image':
            return cloneImagePart(part);
        case 'file':
            return cloneFilePart(part);
    }
}

export function cloneInternalMessage(message: InternalMessage): InternalMessage {
    switch (message.role) {
        case 'assistant': {
            const cloned = structuredClone(message);
            return {
                ...cloned,
                content: message.content === null ? null : cloneContentParts(message.content),
            };
        }
        case 'system': {
            const cloned = structuredClone(message);
            return { ...cloned, content: cloneContentParts(message.content) };
        }
        case 'user': {
            const cloned = structuredClone(message);
            return { ...cloned, content: cloneContentParts(message.content) };
        }
        case 'tool': {
            const cloned = structuredClone(message);
            return { ...cloned, content: cloneContentParts(message.content) };
        }
    }
}

export function cloneInternalMessages(messages: InternalMessage[]): InternalMessage[] {
    return messages.map((message) => cloneInternalMessage(message));
}
