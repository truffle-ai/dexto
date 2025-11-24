import type { StreamingEvent } from '@dexto/core';

/**
 * SSE (Server-Sent Events) streaming utilities for client SDK
 * Adapted from @dexto/webui EventStreamClient
 */

export type MessageStreamEvent = StreamingEvent;

export interface SSEEvent<T = string> {
    event?: string;
    data?: T;
    id?: string;
    retry?: number;
}

export class SSEError extends Error {
    constructor(
        public status: number,
        public body: any
    ) {
        super(`SSE Error: ${status}`);
        this.name = 'SSEError';
    }
}

/**
 * Creates an async generator that yields SSE events from a Response object.
 *
 * @param response The fetch Response object containing the SSE stream
 * @param options Optional configuration including AbortSignal
 */
export async function* stream<T = string>(
    response: Response,
    options?: { signal?: AbortSignal }
): AsyncGenerator<SSEEvent<T>> {
    if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorBody;
        try {
            if (contentType && contentType.includes('application/json')) {
                errorBody = await response.json();
            } else {
                errorBody = await response.text();
            }
        } catch (e) {
            errorBody = 'Unknown error';
        }
        throw new SSEError(response.status, errorBody);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Response body is null');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const signal = options?.signal;

    // Handle abort signal
    let aborted = false;
    const abortHandler = () => {
        aborted = true;
        reader.cancel().catch(() => {
            // Ignore errors during cancel
        });
    };

    if (signal) {
        if (signal.aborted) {
            reader.cancel().catch(() => {});
            return;
        }
        signal.addEventListener('abort', abortHandler);
    }

    try {
        while (true) {
            if (aborted || signal?.aborted) {
                return;
            }

            // Check if we have a double newline in buffer
            const parts = buffer.split('\n\n');
            if (parts.length > 1) {
                const eventString = parts.shift()!;
                buffer = parts.join('\n\n');

                const event = parseSSE(eventString);
                if (event) {
                    yield event as SSEEvent<T>;
                }
                continue;
            }

            // Need more data
            const { done, value } = await reader.read();
            if (done) {
                if (buffer.trim()) {
                    const event = parseSSE(buffer);
                    if (event) {
                        yield event as SSEEvent<T>;
                    }
                }
                return;
            }

            // Normalize CRLF to LF for spec-compliance
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        }
    } finally {
        if (signal) {
            signal.removeEventListener('abort', abortHandler);
        }
        reader.cancel().catch(() => {});
    }
}

/**
 * Helper to create a stream from a promise that resolves to a Response.
 * Useful for chaining with Hono client requests.
 *
 * @example
 * ```typescript
 * const stream = createStream(client.api.chat.$post({ json: { message: 'hi' } }));
 * for await (const event of stream) { ... }
 * ```
 */
export async function* createStream<T = string>(
    responsePromise: Promise<Response>,
    options?: { signal?: AbortSignal }
): AsyncGenerator<SSEEvent<T>> {
    const response = await responsePromise;
    yield* stream<T>(response, options);
}

/**
 * Helper to create a typed message stream from a promise that resolves to a Response.
 * Automatically parses JSON data and yields typed MessageStreamEvent objects.
 *
 * @example
 * ```typescript
 * const stream = createMessageStream(client.api['message-stream'].$post({ ... }));
 * for await (const event of stream) {
 *   if (event.type === 'llm:chunk') {
 *     console.log(event.content);
 *   }
 * }
 * ```
 */
export async function* createMessageStream(
    responsePromise: Promise<Response>,
    options?: { signal?: AbortSignal }
): AsyncGenerator<MessageStreamEvent> {
    const sseStream = createStream(responsePromise, options);
    for await (const event of sseStream) {
        if (event.data) {
            try {
                const parsed = JSON.parse(event.data);
                // Inject the event type from the SSE event if available
                if (event.event && !parsed.type) {
                    parsed.type = event.event;
                }
                yield parsed as MessageStreamEvent;
            } catch (e) {
                // Ignore parse errors for non-JSON data
            }
        }
    }
}

function parseSSE(raw: string): SSEEvent<string> | null {
    const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
    const event: SSEEvent<string> = {};
    let hasData = false;

    for (const line of lines) {
        if (line.startsWith(':')) continue; // Comment

        if (line.startsWith('data: ')) {
            const data = line.slice(6);
            event.data = event.data ? event.data + '\n' + data : data;
            hasData = true;
        } else if (line.startsWith('event: ')) {
            event.event = line.slice(7);
        } else if (line.startsWith('id: ')) {
            event.id = line.slice(4);
        } else if (line.startsWith('retry: ')) {
            event.retry = parseInt(line.slice(7), 10);
        }
    }

    if (!hasData && !event.event && !event.id) return null;
    return event;
}
