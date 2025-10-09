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
                // Embedded resource: content is included directly
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
            case 'resource_link': {
                // Resource link: pointer to be fetched separately
                // Add a text marker so UI knows to fetch this resource
                const linkContent = content as {
                    resource?: {
                        uri?: string;
                    };
                };
                const resource = linkContent.resource;
                if (resource && typeof resource.uri === 'string' && resource.uri.length > 0) {
                    accumulator.textParts.push(`@<${resource.uri}>`);
                    accumulator.resourceUris.push(resource.uri);
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

    // Note: We don't append @<uri> references here because:
    // 1. For embedded resources (type: 'resource'), the content is already in the text
    // 2. resourceUris array is returned for metadata/tracking purposes only
    // 3. The UI should not try to fetch these URIs as separate attachments
    return {
        text: joinedText,
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

        // Preserve _positional array as-is for prompt expansion and mapping
        if (key === '_positional') {
            (args as any)._positional = value;
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

/**
 * Expand simple placeholder syntax in a template using positional args.
 * Supported tokens:
 * - $ARGUMENTS → remaining positional tokens (after $1..$9) joined by a single space
 * - $1..$9     → nth positional token or empty string if missing
 * - $$         → literal dollar sign
 *
 * Notes:
 * - Positional tokens are expected under args._positional as string[]
 * - Key/value args are ignored here (handled separately by providers if needed)
 * - $ARGUMENTS only includes args not consumed by explicit $N placeholders
 */
export function expandPlaceholders(content: string, args?: Record<string, unknown>): string {
    if (!content) return '';

    const positional = Array.isArray((args as any)?._positional)
        ? ((args as any)._positional as string[])
        : [];

    // Protect escaped dollars
    const ESC = '__DOLLAR__PLACEHOLDER__';
    let out = content.replaceAll('$$', ESC);

    // Find highest $N placeholder used in template (1-9)
    let maxExplicitIndex = 0;
    for (let i = 1; i <= 9; i++) {
        if (out.includes(`$${i}`)) {
            maxExplicitIndex = i;
        }
    }

    // $ARGUMENTS → remaining positional args after explicit $N placeholders
    if (out.includes('$ARGUMENTS')) {
        const remainingArgs = positional.slice(maxExplicitIndex);
        out = out.replaceAll('$ARGUMENTS', remainingArgs.join(' '));
    }

    // $1..$9 → corresponding positional token
    for (let i = 1; i <= 9; i++) {
        const token = `$${i}`;
        if (out.includes(token)) {
            const val = positional[i - 1] ?? '';
            // Use split/join to avoid $-replacement semantics in regex
            out = out.split(token).join(val);
        }
    }

    // Restore $$
    out = out.replaceAll(ESC, '$');
    return out;
}
