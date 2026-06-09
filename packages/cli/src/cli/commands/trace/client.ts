import { z } from 'zod';
import { DEXTO_PLATFORM_URL } from '../../auth/constants.js';
import { getDextoApiKey } from '../../auth/service.js';

const TRACE_REQUEST_TIMEOUT_MS = 10_000;

const RunTraceSpanStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);

const RunTraceSpanSchema = z
    .object({
        attributes: z.unknown(),
        durationMs: z.number().nullable(),
        endedAt: z.string().nullable(),
        errorCode: z.string().nullable(),
        errorMessage: z.string().nullable(),
        id: z.string(),
        name: z.string(),
        parentSpanId: z.string().nullable(),
        runAttemptId: z.string().nullable(),
        runId: z.string(),
        sessionId: z.string().nullable(),
        spanId: z.string(),
        startedAt: z.string(),
        status: RunTraceSpanStatusSchema,
        traceId: z.string(),
    })
    .passthrough();

const RunTraceEventSchema = z
    .object({
        attributes: z.unknown(),
        eventId: z.string(),
        name: z.string(),
        occurredAt: z.string(),
        runId: z.string(),
        runSpanId: z.string(),
    })
    .passthrough();

const RunTraceSchema = z
    .object({
        events: z.array(RunTraceEventSchema),
        spans: z.array(RunTraceSpanSchema),
    })
    .passthrough();

const RunTraceResponseSchema = z
    .object({
        trace: RunTraceSchema,
    })
    .passthrough();

const RunTraceSummarySchema = z
    .object({
        durationMs: z.number(),
        errorCount: z.number(),
        eventCount: z.number(),
        firstSpanStartedAt: z.string(),
        lastSpanStartedAt: z.string(),
        runId: z.string(),
        sessionId: z.string(),
        spanCount: z.number(),
        spanNames: z.array(z.string()),
        status: z.string(),
    })
    .passthrough();

const RunTraceListResponseSchema = z
    .object({
        traces: z.array(RunTraceSummarySchema),
    })
    .passthrough();

const RunSpansResponseSchema = z
    .object({
        spans: z.array(RunTraceSpanSchema),
    })
    .passthrough();

export type RunTrace = z.output<typeof RunTraceSchema>;
export type RunTraceSpan = z.output<typeof RunTraceSpanSchema>;
export type RunTraceSummary = z.output<typeof RunTraceSummarySchema>;

export interface TraceClientOptions {
    platformUrl?: string | undefined;
}

export interface RequestOptions {
    signal?: AbortSignal | undefined;
}

export interface FetchRunTraceOptions extends RequestOptions {}

export interface ListRunTracesOptions extends RequestOptions {
    limit?: number | undefined;
    period?: string | undefined;
    sessionId?: string | undefined;
    status?: string | undefined;
}

export interface ListRunSpansOptions extends RequestOptions {
    limit?: number | undefined;
    name?: string | undefined;
    sort?: 'started_at' | 'duration' | undefined;
    status?: string | undefined;
}

export function resolveTracePlatformUrl(platformUrl?: string): string {
    const rawUrl = platformUrl?.trim() || DEXTO_PLATFORM_URL;
    if (rawUrl.trim().length === 0) {
        throw new Error('Dexto platform URL is empty.');
    }

    return rawUrl.replace(/\/+$/, '');
}

async function resolveTraceApiKey(): Promise<string> {
    const apiKey = await getDextoApiKey();
    if (!apiKey?.trim()) {
        throw new Error('Authentication required. Run `dexto login` before using `dexto trace`.');
    }

    return apiKey.trim();
}

async function parseJsonResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return null;
    }

    return response.json().catch(() => null);
}

function formatHttpFailure(status: number, payload: unknown): string {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return `${status} ${JSON.stringify(payload)}`;
    }

    return `${status}`;
}

function appendOptionalSearchParam(
    url: URL,
    key: string,
    value: string | number | undefined
): void {
    if (value === undefined) {
        return;
    }

    url.searchParams.set(key, String(value));
}

function createRequestSignal(signal: AbortSignal | undefined): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(TRACE_REQUEST_TIMEOUT_MS);
    if (!signal) {
        return timeoutSignal;
    }

    return AbortSignal.any([signal, timeoutSignal]);
}

export function createTraceClient(options: TraceClientOptions = {}) {
    const platformBaseUrl = resolveTracePlatformUrl(options.platformUrl);

    async function fetchJson(path: string, fetchOptions: RequestOptions = {}): Promise<unknown> {
        const response = await fetch(`${platformBaseUrl}${path}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${await resolveTraceApiKey()}`,
            },
            signal: createRequestSignal(fetchOptions.signal),
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(`Trace request failed: ${formatHttpFailure(response.status, payload)}`);
        }

        return payload;
    }

    return {
        async fetchRunTrace(
            runId: string,
            fetchOptions: FetchRunTraceOptions = {}
        ): Promise<RunTrace> {
            const payload = await fetchJson(
                `/api/runs/${encodeURIComponent(runId)}/trace`,
                fetchOptions
            );

            return RunTraceResponseSchema.parse(payload).trace;
        },

        async listRunSpans(
            runId: string,
            listOptions: ListRunSpansOptions = {}
        ): Promise<RunTraceSpan[]> {
            const url = new URL(`${platformBaseUrl}/api/runs/${encodeURIComponent(runId)}/spans`);
            appendOptionalSearchParam(url, 'limit', listOptions.limit);
            appendOptionalSearchParam(url, 'name', listOptions.name);
            appendOptionalSearchParam(url, 'sort', listOptions.sort);
            appendOptionalSearchParam(url, 'status', listOptions.status);

            const payload = await fetchJson(`${url.pathname}${url.search}`, listOptions);

            return RunSpansResponseSchema.parse(payload).spans;
        },

        async listRunTraces(listOptions: ListRunTracesOptions = {}): Promise<RunTraceSummary[]> {
            const url = new URL(`${platformBaseUrl}/api/runs/traces`);
            appendOptionalSearchParam(url, 'limit', listOptions.limit);
            appendOptionalSearchParam(url, 'period', listOptions.period);
            appendOptionalSearchParam(url, 'sessionId', listOptions.sessionId);
            appendOptionalSearchParam(url, 'status', listOptions.status);

            const payload = await fetchJson(`${url.pathname}${url.search}`, listOptions);

            return RunTraceListResponseSchema.parse(payload).traces;
        },
    };
}
