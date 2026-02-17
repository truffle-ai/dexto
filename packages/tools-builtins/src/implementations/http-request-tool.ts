import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

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

const BLOCKED_HOSTNAMES = new Set(['localhost']);

function isPrivateIpv4(ip: string): boolean {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
        return false;
    }

    const a = parts[0];
    const b = parts[1];
    if (a === undefined || b === undefined) {
        return false;
    }
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;

    return false;
}

function isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe80::')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('::ffff:')) {
        const ipv4Part = normalized.slice('::ffff:'.length);
        return isPrivateIpv4(ipv4Part);
    }
    return false;
}

function isPrivateAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return false;
}

async function assertSafeUrl(requestUrl: URL): Promise<void> {
    if (!['http:', 'https:'].includes(requestUrl.protocol)) {
        throw new DextoRuntimeError(
            'HTTP_REQUEST_UNSUPPORTED_PROTOCOL',
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Unsupported URL protocol: ${requestUrl.protocol}`
        );
    }

    const hostname = requestUrl.hostname.trim();
    if (!hostname) {
        throw new DextoRuntimeError(
            'HTTP_REQUEST_INVALID_TARGET',
            ErrorScope.TOOLS,
            ErrorType.USER,
            'Request URL hostname is required'
        );
    }

    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
        throw new DextoRuntimeError(
            'HTTP_REQUEST_UNSAFE_TARGET',
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            `Blocked request to local hostname: ${hostname}`
        );
    }

    if (isPrivateAddress(hostname)) {
        throw new DextoRuntimeError(
            'HTTP_REQUEST_UNSAFE_TARGET',
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            `Blocked request to private address: ${hostname}`
        );
    }

    try {
        const records = await dns.lookup(hostname, { all: true });
        for (const record of records) {
            if (isPrivateAddress(record.address)) {
                throw new DextoRuntimeError(
                    'HTTP_REQUEST_UNSAFE_TARGET',
                    ErrorScope.TOOLS,
                    ErrorType.FORBIDDEN,
                    `Blocked request to private address: ${record.address}`
                );
            }
        }
    } catch (error) {
        if (error instanceof DextoRuntimeError) {
            throw error;
        }
        throw new DextoRuntimeError(
            'HTTP_REQUEST_DNS_FAILED',
            ErrorScope.TOOLS,
            ErrorType.THIRD_PARTY,
            `Failed to resolve hostname: ${hostname}`
        );
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

            await assertSafeUrl(requestUrl);

            const requestHeaders: Record<string, string> = headers ? { ...headers } : {};
            let requestBody: string | undefined;

            if (body !== undefined) {
                if (typeof body === 'string') {
                    requestBody = body;
                } else {
                    requestBody = JSON.stringify(body);
                    const hasContentType = Object.keys(requestHeaders).some(
                        (key) => key.toLowerCase() === 'content-type'
                    );
                    if (!hasContentType) {
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
