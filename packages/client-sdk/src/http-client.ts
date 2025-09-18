import { ClientConfig } from './types.js';
import { ClientError } from './errors.js';

// Derive fetch types to avoid relying on DOM lib globals in ESLint
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
    body?: unknown | undefined;
    headers?: Record<string, string> | undefined;
    timeout?: number | undefined;
}

interface FetchFunction {
    (input: FetchInput, init?: FetchInit): Promise<FetchResponse>;
}

/**
 * Universal HTTP client that works in both Node.js and browser environments
 */
export class HttpClient {
    private config: ClientConfig;
    private fetchFn: FetchFunction;

    constructor(config: ClientConfig) {
        this.config = config;

        // Detect environment and set appropriate fetch function
        if (typeof window !== 'undefined' && window.fetch) {
            // Browser environment
            this.fetchFn = window.fetch.bind(window);
        } else if (typeof globalThis !== 'undefined' && globalThis.fetch) {
            // Node.js 18+ with built-in fetch
            this.fetchFn = globalThis.fetch;
        } else {
            // Fallback - should not happen in modern environments
            throw ClientError.invalidConfig(
                'fetch',
                'unavailable',
                'No fetch implementation available. Use Node.js 18+ or a browser.'
            );
        }
    }

    async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
        const { method = 'GET', body, headers = {}, timeout = this.config.timeout } = options;

        const url = new URL(endpoint, this.config.baseUrl).toString();
        const requestHeaders: Record<string, string> = { ...headers };
        const hasContentType = Object.keys(requestHeaders).some(
            (k) => k.toLowerCase() === 'content-type'
        );

        // Decide payload and content-type
        let payload: FetchInit['body'] | undefined = undefined;
        const isBodyInit = (b: unknown): b is FetchInit['body'] => {
            if (b == null) return false;
            return (
                typeof b === 'string' ||
                (typeof globalThis.Blob !== 'undefined' && b instanceof globalThis.Blob) ||
                (typeof globalThis.FormData !== 'undefined' && b instanceof globalThis.FormData) ||
                (typeof globalThis.URLSearchParams !== 'undefined' &&
                    b instanceof globalThis.URLSearchParams) ||
                (typeof globalThis.ReadableStream !== 'undefined' &&
                    b instanceof globalThis.ReadableStream) ||
                (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer)
            );
        };

        if (body !== undefined) {
            if (isBodyInit(body)) {
                payload = body;
            } else {
                payload = JSON.stringify(body);
                if (!hasContentType) {
                    requestHeaders['Content-Type'] = 'application/json';
                }
            }
        }

        // Add API key if provided
        if (this.config.apiKey) {
            requestHeaders['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const requestInit: FetchInit = {
            method,
            headers: requestHeaders,
            ...(payload !== undefined && { body: payload }),
        } as FetchInit;

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        requestInit.signal = controller.signal;

        try {
            const response = await this.fetchWithRetry(url, requestInit);
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = (await this.safeParseJson(response)) as Record<string, unknown>;
                throw ClientError.httpError(
                    response.status,
                    response.statusText,
                    endpoint,
                    errorData
                );
            }

            // Handle empty responses (204 No Content, etc.)
            if (response.status === 204 || response.headers.get('content-length') === '0') {
                return {} as T;
            }

            // Parse based on content-type; health endpoint returns plain text 'OK'
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                return data as T;
            }
            // Fallback to text; ignore body if caller doesn't need it
            const text = await response.text();
            // If caller expects object, return empty object to avoid runtime type errors
            return text ? (text as unknown as T) : ({} as T);
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error && error.name.startsWith('ClientError')) {
                throw error;
            }

            if (error instanceof Error && error.name === 'AbortError') {
                throw ClientError.timeoutError(endpoint, this.config.timeout || 30000);
            }

            throw ClientError.networkError(
                error instanceof Error ? error.message : 'Unknown network error',
                error instanceof Error ? error : undefined
            );
        }
    }

    private async fetchWithRetry(url: string, init: FetchInit): Promise<FetchResponse> {
        let lastError: Error | null = null;
        const method = (init.method || 'GET').toUpperCase();
        const canRetry = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method);
        const maxRetries = this.config.retries ?? 3;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.fetchFn(url, init);

                // Check for transient HTTP status codes that should be retried
                const transientStatus = [429, 502, 503, 504];
                if (canRetry && transientStatus.includes(response.status) && attempt < maxRetries) {
                    // Handle Retry-After header (seconds or HTTP-date)
                    const retryAfter = response.headers.get('retry-after');
                    let delay = Math.min(1000 * Math.pow(2, attempt), 10000);

                    if (retryAfter) {
                        const secs = Number(retryAfter);
                        if (Number.isFinite(secs) && secs >= 0) {
                            // Retry-After in seconds
                            delay = secs * 1000;
                        } else {
                            // Retry-After as HTTP-date
                            const retryTime = Date.parse(retryAfter);
                            if (retryTime > Date.now()) {
                                delay = Math.max(0, retryTime - Date.now());
                            }
                        }
                    }

                    // Cap the delay to reasonable maximum
                    delay = Math.min(delay, 30000); // Max 30 seconds
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                return response;
            } catch (error) {
                lastError =
                    error instanceof Error
                        ? error
                        : ClientError.networkError(
                              error instanceof Error ? error.message : String(error),
                              error instanceof Error ? error : undefined
                          );

                // Don't retry on the last attempt, non-idempotent methods, or for certain error types
                if (
                    attempt === maxRetries ||
                    !canRetry ||
                    (error instanceof Error && error.name === 'AbortError')
                ) {
                    break;
                }

                // Exponential backoff for network errors
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw lastError!;
    }

    private async safeParseJson(response: FetchResponse): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    // Convenience methods
    async get<T>(endpoint: string, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'GET' };
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }

    async post<T>(endpoint: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'POST' };
        if (body !== undefined) options.body = body;
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }

    async put<T>(endpoint: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'PUT' };
        if (body !== undefined) options.body = body;
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }

    async delete<T>(endpoint: string, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'DELETE' };
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }
}
