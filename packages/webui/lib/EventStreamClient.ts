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

export class EventStreamClient {
    async connect(url: string, options?: RequestInit): Promise<AsyncIterableIterator<SSEEvent>> {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options?.headers,
                Accept: 'text/event-stream',
            },
        });

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

        // Extract signal and handle null case
        const signal = options?.signal ?? undefined;
        return this.connectFromResponse(response, signal ? { signal } : undefined);
    }

    /**
     * Connect to an SSE stream from an existing Response object.
     * Useful when the POST request returns the SSE stream directly.
     */
    async connectFromResponse(
        response: Response,
        options?: { signal?: AbortSignal }
    ): Promise<AsyncIterableIterator<SSEEvent>> {
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
                // Already aborted before we started
                reader.cancel().catch(() => {});
            } else {
                signal.addEventListener('abort', abortHandler);
            }
        }

        // Create async iterable iterator
        const iterator: AsyncIterableIterator<SSEEvent> = {
            [Symbol.asyncIterator]() {
                return this;
            },
            async next() {
                // Check if already aborted
                if (aborted || signal?.aborted) {
                    // Remove abort listener when done
                    if (signal) {
                        signal.removeEventListener('abort', abortHandler);
                    }
                    return { value: undefined, done: true };
                }

                // Loop until we have a full event to yield
                while (true) {
                    // Check if we have a double newline in buffer
                    const parts = buffer.split('\n\n');
                    if (parts.length > 1) {
                        // We have at least one complete event
                        const eventString = parts.shift()!;
                        buffer = parts.join('\n\n');

                        const event = parseSSE(eventString);
                        if (event) {
                            return { value: event, done: false };
                        }
                        // If parseSSE returned null (e.g. only comments), loop again
                        continue;
                    }

                    // Need more data
                    const { done, value } = await reader.read();
                    if (done) {
                        // Remove abort listener on normal completion
                        if (signal) {
                            signal.removeEventListener('abort', abortHandler);
                        }
                        if (buffer.trim()) {
                            // Process remaining buffer
                            const event = parseSSE(buffer);
                            buffer = '';
                            if (event) {
                                return { value: event, done: false };
                            }
                        }
                        return { value: undefined, done: true };
                    }

                    // Normalize CRLF to LF for spec-compliance
                    // SSE spec allows CRLF, LF, or CR as line endings
                    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
                }
            },
            async return() {
                // Remove abort listener to prevent memory leak
                if (signal) {
                    signal.removeEventListener('abort', abortHandler);
                }
                reader.cancel();
                return { value: undefined, done: true };
            },
            async throw(e?: any) {
                // Remove abort listener to prevent memory leak
                if (signal) {
                    signal.removeEventListener('abort', abortHandler);
                }
                reader.cancel();
                throw e;
            },
        };

        return iterator;
    }
}

function parseSSE(raw: string): SSEEvent | null {
    // Split on LF and trim any trailing CR from each line
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
