import { createTraceClient } from './client.js';
import { formatSpanList, formatTraceList, formatTraceSummary } from './format.js';

export interface TraceCommandOptions {
    json?: boolean | undefined;
    platformUrl?: string | undefined;
}

export interface TraceListCommandOptions extends TraceCommandOptions {
    limit?: string | number | undefined;
    period?: string | undefined;
    session?: string | undefined;
    status?: string | undefined;
}

export interface SpanListCommandOptions extends TraceCommandOptions {
    limit?: string | number | undefined;
    name?: string | undefined;
    sort?: 'started_at' | 'duration' | undefined;
    status?: string | undefined;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Expected a positive integer, received ${String(value)}.`);
    }

    return parsed;
}

export async function handleTraceCommand(
    runId: string,
    options: TraceCommandOptions = {}
): Promise<void> {
    await handleTraceViewCommand(runId, options);
}

export async function handleTraceViewCommand(
    runId: string,
    options: TraceCommandOptions = {}
): Promise<void> {
    const trace = await createTraceClient({ platformUrl: options.platformUrl }).fetchRunTrace(
        runId
    );

    if (options.json) {
        console.log(JSON.stringify({ trace }, null, 2));
        return;
    }

    console.log(formatTraceSummary(runId, trace));
}

export async function handleTraceListCommand(options: TraceListCommandOptions = {}): Promise<void> {
    const traces = await createTraceClient({ platformUrl: options.platformUrl }).listRunTraces({
        limit: parsePositiveInteger(options.limit, 20),
        ...(options.period === undefined ? {} : { period: options.period }),
        ...(options.session === undefined ? {} : { sessionId: options.session }),
        ...(options.status === undefined ? {} : { status: options.status }),
    });

    if (options.json) {
        console.log(JSON.stringify({ traces }, null, 2));
        return;
    }

    console.log(formatTraceList(traces));
}

export async function handleSpanListCommand(
    runId: string,
    options: SpanListCommandOptions = {}
): Promise<void> {
    const spans = await createTraceClient({ platformUrl: options.platformUrl }).listRunSpans(
        runId,
        {
            limit: parsePositiveInteger(options.limit, 100),
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.sort === undefined ? {} : { sort: options.sort }),
            ...(options.status === undefined ? {} : { status: options.status }),
        }
    );

    if (options.json) {
        console.log(JSON.stringify({ spans }, null, 2));
        return;
    }

    console.log(formatSpanList(runId, spans));
}
