import type { RunTrace, RunTraceSpan, RunTraceSummary } from './client.js';

function formatDuration(span: Pick<RunTraceSpan, 'durationMs'>): string {
    return span.durationMs === null ? 'running' : `${span.durationMs}ms`;
}

function formatDurationMs(durationMs: number | null): string {
    return durationMs === null ? 'running' : `${durationMs}ms`;
}

function sortSpans(spans: RunTraceSpan[]): RunTraceSpan[] {
    return [...spans].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function formatTraceSummary(runId: string, trace: RunTrace): string {
    const lines = [
        `Run trace ${runId}`,
        `Spans: ${trace.spans.length}  Events: ${trace.events.length}`,
    ];

    if (trace.spans.length === 0) {
        lines.push('No spans found.');
        return lines.join('\n');
    }

    lines.push('');
    for (const span of sortSpans(trace.spans)) {
        lines.push(
            `${span.startedAt}  ${span.status.padEnd(9)}  ${formatDuration(span).padStart(8)}  ${span.name}`
        );
        if (span.errorMessage) {
            lines.push(`  error: ${span.errorMessage}`);
        }
    }

    return lines.join('\n');
}

export function formatTraceList(traces: RunTraceSummary[]): string {
    if (traces.length === 0) {
        return 'No run traces found.';
    }

    const lines = ['Recent run traces', ''];
    for (const trace of traces) {
        const names = trace.spanNames.slice(0, 5).join(', ');
        lines.push(
            `${trace.lastSpanStartedAt}  ${trace.status.padEnd(16)}  spans=${String(trace.spanCount).padStart(2)}  errors=${trace.errorCount}  duration=${formatDurationMs(trace.durationMs).padStart(8)}  ${trace.runId}`
        );
        lines.push(`  session: ${trace.sessionId}`);
        if (names.length > 0) {
            lines.push(`  spans: ${names}`);
        }
    }

    return lines.join('\n');
}

export function formatSpanList(runId: string, spans: RunTraceSpan[]): string {
    const lines = [`Spans for run ${runId}`, `Count: ${spans.length}`];

    if (spans.length === 0) {
        lines.push('No spans found.');
        return lines.join('\n');
    }

    lines.push('');
    for (const span of spans) {
        lines.push(
            `${span.startedAt}  ${span.status.padEnd(9)}  ${formatDuration(span).padStart(8)}  ${span.name}`
        );
        lines.push(`  span: ${span.spanId}  trace: ${span.traceId}`);
        if (span.errorMessage) {
            lines.push(`  error: ${span.errorMessage}`);
        }
    }

    return lines.join('\n');
}
