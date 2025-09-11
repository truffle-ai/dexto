import { ClientConfig, DextoClientError, DextoNetworkError } from './types.js';

interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
    timeout?: number;
}

interface FetchFunction {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Universal HTTP client that works in both Node.js and browser environments
 */
export class HttpClient {
    private config: ClientConfig;
    private fetchFn: FetchFunction;

    constructor(config: ClientConfig) {
        this.config = { timeout: 30000, retries: 3, ...config };

        // Detect environment and set appropriate fetch function
        if (typeof window !== 'undefined' && window.fetch) {
            // Browser environment
            this.fetchFn = window.fetch.bind(window);
        } else if (typeof globalThis !== 'undefined' && globalThis.fetch) {
            // Node.js 18+ with built-in fetch
            this.fetchFn = globalThis.fetch;
        } else {
            // Fallback - should not happen in modern environments
            throw new DextoClientError(
                'No fetch implementation available. Use Node.js 18+ or a browser.'
            );
        }
    }

    async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
        const { method = 'GET', body, headers = {}, timeout = this.config.timeout } = options;

        const url = new URL(endpoint, this.config.baseUrl).toString();
        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...headers,
        };

        // Add API key if provided
        if (this.config.apiKey) {
            requestHeaders['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const requestInit: RequestInit = {
            method,
            headers: requestHeaders,
            ...(body !== undefined && { body: JSON.stringify(body) }),
        };

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        requestInit.signal = controller.signal;

        try {
            const response = await this.fetchWithRetry(url, requestInit);
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await this.safeParseJson(response);
                throw new DextoClientError(
                    errorData?.error || `HTTP ${response.status}: ${response.statusText}`,
                    response.status,
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

            if (error instanceof DextoClientError) {
                throw error;
            }

            if (error instanceof Error && error.name === 'AbortError') {
                throw new DextoNetworkError('Request timeout', error);
            }

            throw new DextoNetworkError(
                error instanceof Error ? error.message : 'Unknown network error',
                error instanceof Error ? error : undefined
            );
        }
    }

    private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
        let lastError: DextoNetworkError | null = null;
        const method = (init.method || 'GET').toUpperCase();
        const canRetry = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method);

        for (let attempt = 0; attempt <= this.config.retries!; attempt++) {
            try {
                return await this.fetchFn(url, init);
            } catch (error) {
                lastError =
                    error instanceof DextoNetworkError
                        ? error
                        : new DextoNetworkError(
                              error instanceof Error ? error.message : String(error),
                              error instanceof Error ? error : undefined
                          );

                // Don't retry on the last attempt, non-idempotent methods, or for certain error types
                if (
                    attempt === this.config.retries ||
                    !canRetry ||
                    (error instanceof Error && error.name === 'AbortError')
                ) {
                    break;
                }

                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw lastError!;
    }

    private async safeParseJson(response: Response): Promise<any> {
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

    async post<T>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'POST' };
        if (body) options.body = body;
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }

    async put<T>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'PUT' };
        if (body) options.body = body;
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }

    async delete<T>(endpoint: string, headers?: Record<string, string>): Promise<T> {
        const options: RequestOptions = { method: 'DELETE' };
        if (headers) options.headers = headers;
        return this.request<T>(endpoint, options);
    }
}
