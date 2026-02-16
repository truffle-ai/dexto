import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';

const HttpRequestInputSchema = z
    .object({
        url: z.string().url().describe('Absolute URL to request'),
        method: z
            .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
            .default('GET')
            .describe('HTTP method to use'),
        headers: z
            .record(z.string())
            .optional()
            .describe('Optional request headers (string values only)'),
        query: z
            .record(z.string())
            .optional()
            .describe('Optional query parameters to append to the URL'),
        body: z
            .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
            .optional()
            .describe('Optional request body (string or JSON-serializable value)'),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .optional()
            .default(30000)
            .describe('Request timeout in milliseconds (default: 30000)'),
    })
    .strict();

type HttpRequestInput = z.output<typeof HttpRequestInputSchema>;

type HttpResponsePayload = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    json?: unknown;
};

function isJsonContentType(contentType: string | null): boolean {
    return Boolean(contentType && contentType.toLowerCase().includes('application/json'));
}

function safeJsonParse(text: string): unknown | undefined {
    if (!text.trim()) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * Internal tool for basic HTTP requests.
 */
export function createHttpRequestTool(): Tool {
    return {
        id: 'http_request',
        description:
            'Make a direct HTTP request using fetch. Supports method, headers, query params, JSON bodies, and timeouts. Returns status, headers, raw body text, and parsed JSON when available.',
        inputSchema: HttpRequestInputSchema,
        execute: async (input: unknown, _context: ToolExecutionContext) => {
            const { url, method, headers, query, body, timeoutMs } = input as HttpRequestInput;

            const requestUrl = new URL(url);
            if (query) {
                for (const [key, value] of Object.entries(query)) {
                    requestUrl.searchParams.set(key, value);
                }
            }

            const requestHeaders: Record<string, string> = headers ? { ...headers } : {};
            let requestBody: string | undefined;

            if (body !== undefined) {
                if (typeof body === 'string') {
                    requestBody = body;
                } else {
                    requestBody = JSON.stringify(body);
                    if (!requestHeaders['Content-Type']) {
                        requestHeaders['Content-Type'] = 'application/json';
                    }
                }
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const requestInit: RequestInit = {
                    method,
                    headers: requestHeaders,
                    signal: controller.signal,
                };
                if (requestBody !== undefined) {
                    requestInit.body = requestBody;
                }

                const response = await fetch(requestUrl.toString(), requestInit);

                const responseText = await response.text();
                const contentType = response.headers.get('content-type');
                const json = isJsonContentType(contentType)
                    ? safeJsonParse(responseText)
                    : undefined;

                const responseHeaders: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });

                const payload: HttpResponsePayload = {
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body: responseText,
                    ...(json !== undefined ? { json } : {}),
                };

                return payload;
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new DextoRuntimeError(
                        'HTTP_REQUEST_TIMEOUT',
                        ErrorScope.TOOLS,
                        ErrorType.TIMEOUT,
                        `HTTP request timed out after ${timeoutMs}ms`
                    );
                }

                throw new DextoRuntimeError(
                    'HTTP_REQUEST_FAILED',
                    ErrorScope.TOOLS,
                    ErrorType.THIRD_PARTY,
                    `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
                );
            } finally {
                clearTimeout(timeoutId);
            }
        },
    };
}
