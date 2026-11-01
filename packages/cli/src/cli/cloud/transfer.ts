// Sends local bytes to a URL the server handed out for them, outside MCP JSON.

import { CommandFailure, isJsonObject, type CommandContext } from './command.js';

/** Where the bytes go: a short-lived URL, its method and the headers it expects. */
export interface TransferTarget {
    readonly headers: Readonly<Record<string, string>>;
    readonly method: string;
    readonly url: string;
}

/**
 * Streams `body` to the target with its length, and returns the JSON reply (null when there is
 * none). A refusal fails with the server's own message.
 */
export async function sendBytes(
    context: CommandContext,
    target: TransferTarget,
    body: globalThis.Blob
): Promise<unknown> {
    const response = await context.runtime.fetch(target.url, {
        body,
        headers: { ...target.headers, 'content-length': String(body.size) },
        method: target.method,
        signal: context.runtime.signal,
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (response.ok) return parsed;
    throw new CommandFailure(
        response.status === 404 ? 'not_found' : 'failed',
        `The upload was refused (HTTP ${response.status}): ${refusalMessage(parsed) ?? (text || 'no reason given')}`,
        null
    );
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** `{"error":{"message"}}` from the API, or `{"error_description"}` from an upload route. */
function refusalMessage(body: unknown): string | null {
    if (!isJsonObject(body)) return null;
    if (isJsonObject(body.error) && typeof body.error.message === 'string')
        return body.error.message;
    return typeof body.error_description === 'string' ? body.error_description : null;
}
