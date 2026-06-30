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

export function cloneStructuredValuePreservingUrls<T>(value: T): T {
    return cloneValueWithUrlSupport(value) as T;
}

function cloneValueWithUrlSupport(value: unknown): unknown {
    if (value instanceof URL) {
        return new URL(value.href);
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }
    if (ArrayBuffer.isView(value)) {
        return structuredClone(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneValueWithUrlSupport(item));
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return structuredClone(value);
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cloneValueWithUrlSupport(entry)])
    );
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
            const { content, ...messageWithoutContent } = message;
            const cloned = cloneStructuredValuePreservingUrls(messageWithoutContent);
            return {
                ...cloned,
                content: content === null ? null : cloneContentParts(content),
            };
        }
        case 'system': {
            const { content, ...messageWithoutContent } = message;
            const cloned = cloneStructuredValuePreservingUrls(messageWithoutContent);
            return { ...cloned, content: cloneContentParts(content) };
        }
        case 'user': {
            const { content, ...messageWithoutContent } = message;
            const cloned = cloneStructuredValuePreservingUrls(messageWithoutContent);
            return { ...cloned, content: cloneContentParts(content) };
        }
        case 'tool': {
            const { content, ...messageWithoutContent } = message;
            const cloned = cloneStructuredValuePreservingUrls(messageWithoutContent);
            return { ...cloned, content: cloneContentParts(content) };
        }
    }
}

export function cloneInternalMessages(messages: InternalMessage[]): InternalMessage[] {
    return messages.map((message) => cloneInternalMessage(message));
}
