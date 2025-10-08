import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export interface FlattenedPromptResult {
    text: string;
    resourceUris: string[];
}

function handleContent(
    content: unknown,
    accumulator: {
        textParts: string[];
        resourceUris: string[];
    }
): void {
    if (content == null) {
        return;
    }

    if (typeof content === 'string') {
        accumulator.textParts.push(content);
        return;
    }

    if (Array.isArray(content)) {
        for (const part of content) {
            handleContent(part, accumulator);
        }
        return;
    }

    if (typeof content === 'object') {
        const candidate = content as { type?: string };
        switch (candidate.type) {
            case 'text': {
                const textCandidate = content as { text?: unknown };
                if (typeof textCandidate.text === 'string') {
                    accumulator.textParts.push(textCandidate.text);
                }
                return;
            }
            case 'resource': {
                const resourceContent = content as {
                    resource?: {
                        uri?: string;
                        text?: unknown;
                    };
                };
                const resource = resourceContent.resource;
                if (resource) {
                    if (typeof resource.text === 'string') {
                        accumulator.textParts.push(resource.text);
                    }
                    if (typeof resource.uri === 'string' && resource.uri.length > 0) {
                        accumulator.resourceUris.push(resource.uri);
                    }
                }
                return;
            }
            default:
                // Non-textual content types (image/audio/file) are ignored here; callers can
                // use resource URIs or other channels to handle them explicitly.
                return;
        }
    }
}

export function flattenPromptResult(result: GetPromptResult): FlattenedPromptResult {
    const accumulator = { textParts: [] as string[], resourceUris: [] as string[] };
    const messages = Array.isArray(result.messages) ? result.messages : [];

    for (const message of messages) {
        const maybeContent = (message as { content?: unknown }).content;
        handleContent(maybeContent, accumulator);
    }

    const uniqueUris = Array.from(new Set(accumulator.resourceUris));
    const joinedText = accumulator.textParts
        .map((part) => (typeof part === 'string' ? part : ''))
        .filter((part) => part.length > 0)
        .join('\n')
        .trim();

    const referenceLines = uniqueUris.map((uri) => `@<${uri}>`);
    const text = [joinedText, referenceLines.join('\n')] // maintain order, avoid trailing spaces
        .filter((segment) => segment && segment.length > 0)
        .join('\n\n');

    return {
        text,
        resourceUris: uniqueUris,
    };
}

/**
 * Normalize prompt arguments by converting all values to strings and extracting context.
 * Handles the special `_context` field used for natural language after slash commands.
 */
export function normalizePromptArgs(input: Record<string, unknown>): {
    args: Record<string, string>;
    context?: string | undefined;
} {
    const args: Record<string, string> = {};
    let context: string | undefined;

    for (const [key, value] of Object.entries(input)) {
        if (key === '_context') {
            if (typeof value === 'string' && value.trim().length > 0) {
                const trimmed = value.trim();
                context = trimmed;
                // Don't add _context to args - it's handled separately
                // ToDo: handle arg parsing for prompts
            }
            continue;
        }

        if (typeof value === 'string') {
            args[key] = value;
        } else if (value !== undefined && value !== null) {
            try {
                args[key] = JSON.stringify(value);
            } catch {
                args[key] = String(value);
            }
        }
    }

    return { args, context };
}

/**
 * Append context to text, handling empty cases gracefully.
 */
export function appendContext(text: string, context?: string): string {
    if (!context || context.trim().length === 0) {
        return text ?? '';
    }
    if (!text || text.trim().length === 0) {
        return context;
    }
    return `${text}\n\n${context}`;
}
