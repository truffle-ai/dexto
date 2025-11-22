/**
 * SSE (Server-Sent Events) streaming utilities for client SDK
 * Adapted from @dexto/webui EventStreamClient
 */

export interface SSEEvent {
    event?: string;
    data?: string;
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
export async function* stream(
    response: Response,
    options?: { signal?: AbortSignal }
): AsyncGenerator<SSEEvent> {
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
                    yield event;
                }
                continue;
            }

            // Need more data
            const { done, value } = await reader.read();
            if (done) {
                if (buffer.trim()) {
                    const event = parseSSE(buffer);
                    if (event) {
                        yield event;
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
export async function* createStream(
    responsePromise: Promise<Response>,
    options?: { signal?: AbortSignal }
): AsyncGenerator<SSEEvent> {
    const response = await responsePromise;
    yield* stream(response, options);
}

function parseSSE(raw: string): SSEEvent | null {
    const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
    const event: SSEEvent = {};
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
