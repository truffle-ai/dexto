// A session's events, as `GET /v1/agents/{agent_id}/sessions/{session_id}/events` streams them.

import type { CommandContext } from './command.js';
import { sendV1, v1Failure } from './v1.js';

interface RunUsage {
    readonly credits: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
}

/** The events a run sends that the CLI shows; the API documents each. */
export type AgentEvent =
    | { readonly type: 'run.started'; readonly run_id: string }
    | { readonly type: 'message.delta'; readonly run_id: string; readonly text: string }
    | { readonly type: 'message.completed'; readonly run_id: string; readonly text: string }
    | {
          readonly type: 'tool.started';
          readonly run_id: string;
          readonly name: string;
          readonly arguments: unknown;
      }
    | {
          readonly type: 'tool.completed';
          readonly run_id: string;
          readonly name: string;
          readonly status: string;
          readonly error: { readonly code: string; readonly message: string } | null;
      }
    | {
          readonly type: 'approval.requested';
          readonly run_id: string;
          readonly approval_id: string;
          readonly tool_name: string | null;
          readonly input: unknown;
      }
    | { readonly type: 'approval.resolved'; readonly run_id: string }
    | {
          readonly type: 'run.completed';
          readonly run_id: string;
          readonly stop_reason: string;
          readonly usage: RunUsage;
      }
    | {
          readonly type: 'run.failed';
          readonly run_id: string;
          readonly error: { readonly code: string; readonly message: string };
      }
    | { readonly type: 'run.cancelled'; readonly run_id: string };

const TYPES: ReadonlySet<string> = new Set<AgentEvent['type']>([
    'run.started',
    'message.delta',
    'message.completed',
    'tool.started',
    'tool.completed',
    'approval.requested',
    'approval.resolved',
    'run.completed',
    'run.failed',
    'run.cancelled',
]);

/** A known event; the server's own contract carries the rest of its fields. */
function isAgentEvent(value: unknown): value is AgentEvent {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        typeof value.type === 'string' &&
        TYPES.has(value.type) &&
        'run_id' in value &&
        typeof value.run_id === 'string'
    );
}

/** Parses one SSE block; comments, blocks without data and unknown events are skipped. */
export function parseEventBlock(block: string): AgentEvent | null {
    const data: string[] = [];
    for (const line of block.split('\n'))
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    if (data.length === 0) return null;
    let value: unknown;
    try {
        value = JSON.parse(data.join('\n'));
    } catch {
        return null;
    }
    return isAgentEvent(value) ? value : null;
}

/** The session's events until the stream closes or `signal` aborts. */
export async function* sessionEvents(
    context: CommandContext,
    agentId: string,
    sessionId: string,
    signal: AbortSignal
): AsyncGenerator<AgentEvent> {
    const response = await sendV1(
        context,
        'GET',
        `/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/events`,
        { body: null, headers: { accept: 'text/event-stream' } },
        signal
    );
    if (!response.ok) throw v1Failure(context, response.status, await response.text());
    if (response.body === null) return;
    const reader = response.body.pipeThrough(new globalThis.TextDecoderStream()).getReader();
    let buffer = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
                const event = parseEventBlock(block);
                if (event !== null) yield event;
            }
        }
        const last = parseEventBlock(buffer);
        if (last !== null) yield last;
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}
