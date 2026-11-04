// `trace list|view` and `span list`: a person's run traces, read from /v1/traces.

import { unwrap, type V1Response } from '@dexto/cloud-client';

import {
    argument,
    integerOption,
    stringOption,
    UsageError,
    type Command,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';

type TraceSummary = V1Response<'/v1/traces', 'get'>['data'][number];
type RunTrace = V1Response<'/v1/traces/{run_id}', 'get'>;
type Span = RunTrace['spans'][number];

const RUN_STATUSES = [
    'cancelled',
    'completed',
    'failed',
    'queued',
    'retrying',
    'running',
    'waiting_approval',
] as const satisfies readonly TraceSummary['status'][];
const SPAN_STATUSES = ['completed', 'failed'] as const satisfies readonly Span['status'][];
const SPAN_SORTS = ['started_at', 'duration'] as const;

const TRACE_COLUMNS: readonly Column<TraceSummary>[] = [
    { header: 'run', value: (trace) => trace.run_id },
    { header: 'status', value: (trace) => trace.status },
    { header: 'spans', value: (trace) => trace.span_count },
    { header: 'errors', value: (trace) => trace.error_count },
    { header: 'duration', value: (trace) => milliseconds(trace.duration_ms) },
    { header: 'last span', value: (trace) => trace.last_span_started_at },
    { header: 'session', value: (trace) => trace.session_id },
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
        const status = choice(input, 'status', RUN_STATUSES);
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
        const sort = choice(input, 'sort', SPAN_SORTS);
        const status = choice(input, 'status', SPAN_STATUSES);
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

/** A string option that must be one of `values`, checked before anything is sent. */
function choice<const T extends string>(
    input: CommandInput,
    name: string,
    values: readonly T[]
): T | undefined {
    const value = stringOption(input, name);
    if (value === undefined) return undefined;
    const known = values.find((each) => each === value);
    if (known === undefined) throw new UsageError(`--${name} must be one of ${values.join(', ')}.`);
    return known;
}

function milliseconds(value: number): string {
    return `${Math.round(value)}ms`;
}

/** 1.x's `dexto trace` view: one line per span, by start time, with its error under it. */
function formatTrace(trace: RunTrace): string {
    const lines = [
        `Run trace ${trace.run_id}`,
        `Spans: ${trace.spans.length}  Events: ${trace.events.length}`,
    ];
    if (trace.spans.length === 0) return [...lines, 'No spans found.'].join('\n');
    lines.push('');
    const spans = [...trace.spans].sort((left, right) =>
        left.started_at.localeCompare(right.started_at)
    );
    for (const span of spans) {
        lines.push(
            `${span.started_at}  ${span.status.padEnd(9)}  ${milliseconds(span.duration_ms).padStart(8)}  ${span.name}`
        );
        if (span.error_message !== null) lines.push(`  error: ${span.error_message}`);
    }
    return lines.join('\n');
}

export const traceCommands: readonly Command[] = [traceList, traceView, spanList];
