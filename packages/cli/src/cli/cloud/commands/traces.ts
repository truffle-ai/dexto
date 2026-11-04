// `trace list|view` and `span list`: a person's run traces, read from /v1/traces.

import { unwrap, type paths, type V1Response } from '@dexto/cloud-client';

import { argument, choiceOption, integerOption, stringOption, type Command } from '../command.js';
import type { Column } from '../output.js';

type TraceSummary = V1Response<'/v1/traces', 'get'>['data'][number];
type RunTrace = V1Response<'/v1/traces/{run_id}', 'get'>;
type Span = RunTrace['spans'][number];
type TraceQuery = NonNullable<paths['/v1/traces']['get']['parameters']['query']>;
type SpanQuery = NonNullable<paths['/v1/traces/{run_id}/spans']['get']['parameters']['query']>;

/**
 * Every value the server takes for one query option, and no other: a value added or removed on the
 * server fails to compile here, so the CLI never refuses what the server accepts.
 */
function everyValue<Union extends string>() {
    return <const List extends readonly Union[]>(
        list: List & ([Exclude<Union, List[number]>] extends [never] ? unknown : never)
    ): List => list;
}

const RUN_STATUSES = everyValue<NonNullable<TraceQuery['status']>>()([
    'cancelled',
    'completed',
    'failed',
    'queued',
    'retrying',
    'running',
    'waiting_approval',
]);
const SPAN_STATUSES = everyValue<NonNullable<SpanQuery['status']>>()(['completed', 'failed']);
const SPAN_SORTS = everyValue<NonNullable<SpanQuery['sort']>>()(['started_at', 'duration']);

const TRACE_COLUMNS: readonly Column<TraceSummary>[] = [
    { header: 'run', value: (trace) => trace.run_id },
    { header: 'status', value: (trace) => trace.status },
    { header: 'spans', value: (trace) => trace.span_count },
    { header: 'errors', value: (trace) => trace.error_count },
    { header: 'duration', value: (trace) => milliseconds(trace.duration_ms) },
    { header: 'last span', value: (trace) => trace.last_span_started_at },
    { header: 'session', value: (trace) => trace.session_id },
    { header: 'span names', value: (trace) => trace.span_names.join(', ') },
];

const SPAN_COLUMNS: readonly Column<Span>[] = [
    { header: 'started', value: (span) => span.started_at },
    { header: 'status', value: (span) => span.status },
    { header: 'duration', value: (span) => milliseconds(span.duration_ms) },
    { header: 'name', value: (span) => span.name },
    { header: 'span', value: (span) => span.span_id },
    { header: 'error', value: (span) => span.error_message },
];

const traceList: Command = {
    options: {
        limit: { description: 'How many to return (at most 100).', type: 'string', valueName: 'N' },
        period: {
            description: 'Only runs with a span in this recent period, such as 15m, 3h or 7d.',
            type: 'string',
        },
        session: { description: 'Only runs of this chat.', type: 'string', valueName: 'ID' },
        status: {
            description: `Only runs in this status: ${RUN_STATUSES.join(', ')}.`,
            type: 'string',
        },
    },
    path: ['trace', 'list'],
    summary: 'List your recent run traces, newest first. Spans are kept 30 days.',
    async run(context, input) {
        const limit = integerOption(input, 'limit');
        const period = stringOption(input, 'period');
        const session = stringOption(input, 'session');
        const status = choiceOption(input, 'status', RUN_STATUSES);
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/traces', {
                params: {
                    query: {
                        ...(limit === undefined ? {} : { limit }),
                        ...(period === undefined ? {} : { period }),
                        ...(session === undefined ? {} : { session_id: session }),
                        ...(status === undefined ? {} : { status }),
                    },
                },
            })
        );
        context.output.list(page, TRACE_COLUMNS);
        if (page.has_more && !context.output.json)
            context.output.note(
                'More traces match: narrow --period or raise --limit (at most 100).'
            );
    },
};

const traceView: Command = {
    arguments: '<run_id>',
    path: ['trace', 'view'],
    summary: "Show one run's trace: its spans in start order, with any errors.",
    async run(context, input) {
        const runId = argument(input, 0, 'run_id');
        const trace = await unwrap(
            await (
                await context.client()
            ).GET('/v1/traces/{run_id}', { params: { path: { run_id: runId } } })
        );
        context.output.result(trace, formatTrace(trace));
        if (trace.has_more && !context.output.json)
            context.output.note(
                `This trace stops at ${trace.spans.length} spans. See the rest with dexto span list ${runId} --name or --status.`
            );
    },
};

const spanList: Command = {
    arguments: '<run_id>',
    options: {
        limit: { description: 'How many to return (at most 500).', type: 'string', valueName: 'N' },
        name: { description: 'Only spans with exactly this name.', type: 'string' },
        sort: {
            description: 'started_at (default), or duration for the longest first.',
            type: 'string',
        },
        status: { description: 'Only spans that completed or failed.', type: 'string' },
    },
    path: ['span', 'list'],
    summary: "List one run's spans.",
    async run(context, input) {
        const runId = argument(input, 0, 'run_id');
        const limit = integerOption(input, 'limit');
        const name = stringOption(input, 'name');
        const sort = choiceOption(input, 'sort', SPAN_SORTS);
        const status = choiceOption(input, 'status', SPAN_STATUSES);
        const page = await unwrap(
            await (
                await context.client()
            ).GET('/v1/traces/{run_id}/spans', {
                params: {
                    path: { run_id: runId },
                    query: {
                        ...(limit === undefined ? {} : { limit }),
                        ...(name === undefined ? {} : { name }),
                        ...(sort === undefined ? {} : { sort }),
                        ...(status === undefined ? {} : { status }),
                    },
                },
            })
        );
        context.output.list(page, SPAN_COLUMNS);
        if (page.has_more && !context.output.json)
            context.output.note(
                'More spans match: filter with --name or raise --limit (at most 500).'
            );
    },
};

function milliseconds(value: number): string {
    return `${Math.round(value)}ms`;
}

/** 1.x's `dexto trace` view: one line per span, with its error under it. */
function formatTrace(trace: RunTrace): string {
    const lines = [
        `Run trace ${trace.run_id}`,
        `Spans: ${trace.spans.length}  Events: ${trace.events.length}`,
    ];
    if (trace.spans.length === 0) return [...lines, 'No spans found.'].join('\n');
    lines.push('');
    // The API returns spans by start time.
    for (const span of trace.spans) {
        lines.push(
            `${span.started_at}  ${span.status.padEnd(9)}  ${milliseconds(span.duration_ms).padStart(8)}  ${span.name}`
        );
        if (span.error_message !== null) lines.push(`  error: ${span.error_message}`);
    }
    return lines.join('\n');
}

export const traceCommands: readonly Command[] = [traceList, traceView, spanList];
