import { APICallError } from 'ai';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';

export type LLMProviderErrorDetails = {
    provider?: string;
    model?: string;
    statusCode?: number;
    retryAfter?: number;
    responseBody?: string;
    openRouterErrorCode?: string | number;
    openRouterErrorMessage?: string;
    openRouterProviderName?: string;
    openRouterProviderRaw?: unknown;
    openRouterProviderRawMessage?: string;
    openRouterProviderRawParam?: string;
    openRouterProviderRawCode?: string | number;
    openRouterPreviousErrorCount?: number;
    url?: string;
    isRetryable?: boolean;
};

export type MapProviderErrorInput = {
    error: unknown;
    provider: string;
    model: string;
    sessionId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function readScalar(value: unknown): string | number | boolean | undefined {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
}

function readStringOrNumber(value: unknown): string | number | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRetryAfter(headers: Record<string, string> | undefined): number | undefined {
    const retryAfter = headers?.['retry-after'];
    if (retryAfter === undefined) return undefined;
    const value = Number(retryAfter);
    return Number.isFinite(value) ? value : undefined;
}

function stringifyBody(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return undefined;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function readErrorEnvelope(body: Record<string, unknown> | null): Record<string, unknown> | null {
    const error = body?.error;
    return isRecord(error) ? error : null;
}

function addOpenRouterDetails(details: LLMProviderErrorDetails, responseBody: string): void {
    const body = parseJsonObject(responseBody);
    const errorEnvelope = readErrorEnvelope(body);
    if (errorEnvelope === null) return;

    const code = readStringOrNumber(errorEnvelope.code);
    if (code !== undefined) details.openRouterErrorCode = code;

    const message = readString(errorEnvelope.message);
    if (message !== undefined) details.openRouterErrorMessage = message;

    const metadata = isRecord(errorEnvelope.metadata) ? errorEnvelope.metadata : null;
    if (metadata === null) return;

    const providerName = readString(metadata.provider_name);
    if (providerName !== undefined) details.openRouterProviderName = providerName;

    if (Reflect.has(metadata, 'raw')) {
        details.openRouterProviderRaw = metadata.raw;
    }

    const rawObject = parseJsonObject(metadata.raw);
    const rawError = readErrorEnvelope(rawObject);
    const rawMessage = readString(rawError?.message);
    if (rawMessage !== undefined) details.openRouterProviderRawMessage = rawMessage;

    const rawParam = readString(rawError?.param);
    if (rawParam !== undefined) details.openRouterProviderRawParam = rawParam;

    const rawCode = readStringOrNumber(rawError?.code);
    if (rawCode !== undefined) details.openRouterProviderRawCode = rawCode;

    const previousErrors = metadata.previous_errors;
    if (Array.isArray(previousErrors)) {
        details.openRouterPreviousErrorCount = previousErrors.length;
    }
}

function providerMessage(details: LLMProviderErrorDetails, fallback: string): string {
    return (
        details.openRouterProviderRawMessage ??
        details.openRouterErrorMessage ??
        details.responseBody ??
        fallback
    );
}

function errorTypeForStatus(status: number | undefined): ErrorType {
    if (status === 402) return ErrorType.PAYMENT_REQUIRED;
    if (status === 403) return ErrorType.FORBIDDEN;
    if (status === 408) return ErrorType.TIMEOUT;
    if (status === 429) return ErrorType.RATE_LIMIT;
    if (status !== undefined && status >= 400 && status < 500) return ErrorType.USER;
    return ErrorType.THIRD_PARTY;
}

function errorCodeForStatus(
    status: number | undefined,
    details: LLMProviderErrorDetails
): LLMErrorCode {
    if (status === 402) return LLMErrorCode.INSUFFICIENT_CREDITS;
    if (status === 429) return LLMErrorCode.RATE_LIMIT_EXCEEDED;
    if (
        status === 400 &&
        (details.openRouterProviderRawCode === 'invalid_function_parameters' ||
            details.openRouterErrorCode === 400)
    ) {
        return LLMErrorCode.REQUEST_INVALID_SCHEMA;
    }
    return LLMErrorCode.GENERATION_FAILED;
}

function buildContext(input: MapProviderErrorInput, details: LLMProviderErrorDetails) {
    return {
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        provider: input.provider,
        model: input.model,
        ...details,
    };
}

export function extractProviderErrorDetails(input: MapProviderErrorInput): LLMProviderErrorDetails {
    const details: LLMProviderErrorDetails = {
        provider: input.provider,
        model: input.model,
    };

    if (!APICallError.isInstance?.(input.error)) return details;

    const responseHeaders = (input.error.responseHeaders || {}) as Record<string, string>;
    const responseBody = stringifyBody(input.error.responseBody);

    if (input.error.statusCode !== undefined) details.statusCode = input.error.statusCode;
    const retryAfter = readRetryAfter(responseHeaders);
    if (retryAfter !== undefined) details.retryAfter = retryAfter;
    if (responseBody !== undefined) details.responseBody = responseBody;
    if (input.error.url !== undefined) details.url = input.error.url;
    details.isRetryable = input.error.isRetryable;

    if (responseBody !== undefined) {
        addOpenRouterDetails(details, responseBody);
    }

    return details;
}

export function mapProviderError(input: MapProviderErrorInput): Error {
    if (input.error instanceof DextoRuntimeError) return input.error;

    if (!APICallError.isInstance?.(input.error)) {
        return input.error instanceof Error ? input.error : new Error(String(input.error));
    }

    const details = extractProviderErrorDetails(input);
    const status = input.error.statusCode;
    const message = providerMessage(details, input.error.message);
    const code = errorCodeForStatus(status, details);
    const type = errorTypeForStatus(status);

    return new DextoRuntimeError(
        code,
        ErrorScope.LLM,
        type,
        status === undefined ? message : `Provider error ${status}: ${message}`,
        buildContext(input, details)
    );
}
