// A typed client for Dexto's public /v1 API, from the OpenAPI document it serves (DEXTO-2033).

import createClient from 'openapi-fetch';
import type { paths } from './generated/v1.js';

export type { paths } from './generated/v1.js';

const DEXTO_CLOUD_PROJECT_HEADER = 'Dexto-Cloud-Project';

export interface CloudClientOptions {
    /** Such as `https://api.dexto.ai`. */
    readonly apiBaseUrl: string;
    /** An API key, or a function asked before every request for a person's fresh access token. */
    readonly token: string | (() => Promise<string>);
    /** The Cloud project a person's token acts in; null for a key, which acts in its own. */
    readonly cloudProject: string | null;
    readonly fetch?: typeof globalThis.fetch;
}

export type CloudClient = ReturnType<typeof createClient<paths>>;

export function createCloudClient(options: CloudClientOptions): CloudClient {
    const client = createClient<paths>({
        baseUrl: options.apiBaseUrl.replace(/\/+$/u, ''),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    client.use({
        async onRequest({ request }) {
            const token = typeof options.token === 'string' ? options.token : await options.token();
            request.headers.set('authorization', `Bearer ${token}`);
            if (options.cloudProject !== null)
                request.headers.set(DEXTO_CLOUD_PROJECT_HEADER, options.cloudProject);
            return request;
        },
    });
    return client;
}

/** A refusal from Dexto, from its `{ error: { code, message, requestId, retryable } }` envelope. */
export class CloudApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId: string | null;
    readonly retryable: boolean;
    readonly details: unknown;

    constructor(input: {
        status: number;
        code: string;
        message: string;
        requestId: string | null;
        retryable: boolean;
        details: unknown;
    }) {
        super(input.message);
        this.name = 'CloudApiError';
        this.status = input.status;
        this.code = input.code;
        this.requestId = input.requestId;
        this.retryable = input.retryable;
        this.details = input.details;
    }
}

/** The response's data, or a CloudApiError for Dexto's error envelope. */
export async function unwrap<Data>(result: {
    data?: Data;
    error?: unknown;
    response: Response;
}): Promise<Data> {
    if (result.error === undefined) {
        if (result.data === undefined) throw errorFor(result.response.status, null);
        return result.data;
    }
    throw errorFor(result.response.status, result.error);
}

function errorFor(status: number, body: unknown): CloudApiError {
    const envelope = readEnvelope(body);
    return new CloudApiError({
        status,
        code: envelope?.code ?? `http_${status}`,
        message: envelope?.message ?? `Dexto answered HTTP ${status}.`,
        requestId: envelope?.requestId ?? null,
        retryable: envelope?.retryable ?? status >= 500,
        details: envelope?.details,
    });
}

function readEnvelope(body: unknown): {
    code: string;
    message: string;
    requestId: string | null;
    retryable: boolean;
    details: unknown;
} | null {
    if (typeof body !== 'object' || body === null || !('error' in body)) return null;
    const error: unknown = body.error;
    if (typeof error !== 'object' || error === null) return null;
    const field = (name: string): unknown => (name in error ? Reflect.get(error, name) : undefined);
    const code = field('code');
    const message = field('message');
    if (typeof code !== 'string' || typeof message !== 'string') return null;
    const requestId = field('requestId');
    const retryable = field('retryable');
    return {
        code,
        message,
        requestId: typeof requestId === 'string' ? requestId : null,
        retryable: retryable === true,
        details: field('details'),
    };
}
