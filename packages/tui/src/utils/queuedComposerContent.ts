import type { QueuedMessage, ContentPart, ImagePart, TextPart } from '@dexto/core';
import type { PendingImage } from '../state/types.js';

interface ComposerQueuedContent {
    text: string;
    images: PendingImage[];
}

type RestoreQueuedContentResult =
    | {
          ok: true;
          composer: ComposerQueuedContent;
      }
    | {
          ok: false;
          reason: string;
      };

function imagePlaceholder(index: number): string {
    return `[Image ${index}]`;
}

function imagePlaceholdersIn(text: string): string[] {
    const seen = new Set<string>();
    const placeholders: string[] = [];
    for (const match of text.matchAll(/\[Image \d+\]/g)) {
        const placeholder = match[0];
        if (!seen.has(placeholder)) {
            seen.add(placeholder);
            placeholders.push(placeholder);
        }
    }
    return placeholders;
}

function nextImagePlaceholder(usedPlaceholders: Set<string>): string {
    let index = 1;
    while (usedPlaceholders.has(imagePlaceholder(index))) {
        index += 1;
    }
    const placeholder = imagePlaceholder(index);
    usedPlaceholders.add(placeholder);
    return placeholder;
}

function imageDataForComposer(part: ImagePart): string {
    if (typeof part.image === 'string') {
        return part.image;
    }

    if (part.image instanceof URL) {
        return part.image.toString();
    }

    if (part.image instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(part.image)).toString('base64');
    }

    return Buffer.from(part.image).toString('base64');
}

function textParts(content: ContentPart[]): TextPart[] {
    return content.filter((part): part is TextPart => part.type === 'text');
}

function imageParts(content: ContentPart[]): ImagePart[] {
    return content.filter((part): part is ImagePart => part.type === 'image');
}

function unsupportedParts(content: ContentPart[]): ContentPart[] {
    return content.filter((part) => part.type !== 'text' && part.type !== 'image');
}

function appendPlaceholderSegment(segments: string[], placeholder: string): void {
    const previousSegment = segments[segments.length - 1];
    if (previousSegment?.match(/^\[Image \d+\]( \[Image \d+\])*$/)) {
        segments[segments.length - 1] = `${previousSegment} ${placeholder}`;
        return;
    }
    segments.push(placeholder);
}

function composerTextAndPlaceholders(content: ContentPart[]): {
    text: string;
    placeholders: string[];
} {
    const text = textParts(content)
        .map((part) => part.text)
        .join('\n');
    const existingPlaceholders = imagePlaceholdersIn(text);
    const usedPlaceholders = new Set(existingPlaceholders);
    const placeholders: string[] = [];
    const segments: string[] = [];
    let existingPlaceholderIndex = 0;

    for (const part of content) {
        if (part.type === 'text') {
            if (part.text.length > 0) {
                segments.push(part.text);
            }
            continue;
        }

        if (part.type !== 'image') {
            continue;
        }

        const existingPlaceholder = existingPlaceholders[existingPlaceholderIndex];
        if (existingPlaceholder) {
            placeholders.push(existingPlaceholder);
            existingPlaceholderIndex += 1;
            continue;
        }

        const placeholder = nextImagePlaceholder(usedPlaceholders);
        placeholders.push(placeholder);
        appendPlaceholderSegment(segments, placeholder);
    }

    return { text: segments.join('\n'), placeholders };
}

export function restoreQueuedContentForComposer(
    message: QueuedMessage
): RestoreQueuedContentResult {
    const unsupported = unsupportedParts(message.content);
    if (unsupported.length > 0) {
        return {
            ok: false,
            reason: 'Queued input with non-image attachments cannot be edited in the terminal yet.',
        };
    }

    const images = imageParts(message.content);

    const composer = composerTextAndPlaceholders(message.content);

    return {
        ok: true,
        composer: {
            text: composer.text,
            images: images.map((part, index) => ({
                id: `${message.id}-image-${index + 1}`,
                data: imageDataForComposer(part),
                mimeType: part.mimeType ?? 'image/png',
                placeholder: composer.placeholders[index] ?? imagePlaceholder(index + 1),
            })),
        },
    };
}

export function previewQueuedContent(content: ContentPart[]): string {
    const textWithImages = composerTextAndPlaceholders(content).text.replace(/\n/g, ' ');

    const markers = content
        .filter((part) => part.type !== 'text' && part.type !== 'image')
        .map((part) => {
            switch (part.type) {
                case 'file':
                    return part.filename ? `[file: ${part.filename}]` : '[file]';
                case 'resource':
                    return `[resource: ${part.name}]`;
                case 'ui-resource':
                    return '[ui resource]';
            }
        });

    return [textWithImages, ...markers].filter(Boolean).join(' ') || '[attachment]';
}
