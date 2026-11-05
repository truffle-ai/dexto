import {
    ApprovalType,
    DextoRuntimeError,
    LLMErrorCode,
    type ApprovalRequest,
    type StreamingEvent,
} from '@dexto/core';
import { HEADLESS_APPROVAL_MESSAGE } from '../../approval/headless-approval-handler.js';
import { CommandFailure, EXIT_CODES, type FailureKind } from '../../failure.js';
import type { HeadlessRunResult } from './headless.js';

/** How `dexto run` prints: the reply as text, one JSON result, or JSON events then the result. */
export type HeadlessOutputFormat = 'text' | 'json' | 'stream-json';

/**
 * --json, --stream-json or --text as given, else JSON when stdout isn't a terminal (an agent or a
 * pipe reads it) and text at one; null when more than one was given.
 */
export function chooseHeadlessOutput(
    options: { json?: boolean; streamJson?: boolean; text?: boolean },
    stdoutIsTerminal: boolean
): HeadlessOutputFormat | null {
    const chosen = [
        options.json === true ? 'json' : null,
        options.streamJson === true ? 'stream-json' : null,
        options.text === true ? 'text' : null,
    ].filter((each): each is HeadlessOutputFormat => each !== null);
    if (chosen.length > 1) return null;
    return chosen[0] ?? (stdoutIsTerminal ? 'text' : 'json');
}

/**
 * An approval the run asked for that no one here could give, so it was refused and the run went
 * on without it: listed as the result's `permission_denials`.
 */
export type HeadlessApprovalRequired = {
    approval_id: string;
    session_id?: string;
    message: string;
} & (
    | { approval_type: typeof ApprovalType.TOOL_APPROVAL; tool_name: string; tool_call_id: string }
    | { approval_type: typeof ApprovalType.COMMAND_APPROVAL; tool_name: string }
    | {
          approval_type: Exclude<
              ApprovalRequest['type'],
              typeof ApprovalType.TOOL_APPROVAL | typeof ApprovalType.COMMAND_APPROVAL
          >;
      }
);

export function toHeadlessApprovalRequired(request: ApprovalRequest): HeadlessApprovalRequired {
    const correlation = {
        approval_id: request.approvalId,
        ...(request.sessionId !== undefined ? { session_id: request.sessionId } : {}),
        message: HEADLESS_APPROVAL_MESSAGE,
    };
    switch (request.type) {
        case ApprovalType.TOOL_APPROVAL:
            return {
                ...correlation,
                approval_type: request.type,
                tool_name: request.metadata.toolName,
                tool_call_id: request.metadata.toolCallId,
            };
        case ApprovalType.COMMAND_APPROVAL:
            return {
                ...correlation,
                approval_type: request.type,
                tool_name: request.metadata.toolName,
            };
        default:
            return { ...correlation, approval_type: request.type };
    }
}

/** Why a run failed, with its exit code's kind and, where there is one, the command that fixes it. */
export interface HeadlessFailure {
    readonly code: FailureKind | 'usage';
    readonly message: string;
    readonly fix: string | null;
}

/**
 * A missing provider key, with no Dexto sign-in standing in for it, needs sign-in (exit 3) like
 * the cloud commands; anything else the run didn't expect is `failed`.
 */
export function describeHeadlessFailure(error: Error): HeadlessFailure {
    if (error instanceof CommandFailure)
        return { code: error.kind, message: error.message, fix: error.fix };
    if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.API_KEY_MISSING) {
        const context = error.context;
        const envVar =
            typeof context === 'object' &&
            context !== null &&
            'envVar' in context &&
            typeof context.envVar === 'string'
                ? context.envVar
                : 'a provider key';
        return {
            code: 'needs_sign_in',
            message: `Sign in to use Dexto models, or set ${envVar}.`,
            fix: 'dexto login',
        };
    }
    return { code: 'failed', message: error.message, fix: null };
}

export function headlessExitCode(failure: HeadlessFailure | null): number {
    return failure === null ? 0 : EXIT_CODES[failure.code];
}

/**
 * The run's one result, for --json and as --stream-json's last line. A failure also goes on
 * stderr as JSON, as the CLI's other commands do; nothing else is written there in these modes.
 */
export async function writeHeadlessResult(
    format: Exclude<HeadlessOutputFormat, 'text'>,
    result: HeadlessRunResult,
    sessionId: string | undefined,
    failure: HeadlessFailure | null
): Promise<void> {
    const error =
        failure === null
            ? null
            : {
                  code: failure.code,
                  message: failure.message,
                  ...(failure.fix === null ? {} : { fix: failure.fix }),
              };
    if (error !== null) process.stderr.write(`${JSON.stringify({ error })}\n`);
    await writeJsonLineToStdout({
        type: 'result',
        status: error === null ? 'completed' : 'failed',
        ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        ...(result.finalMessage !== undefined ? { content: result.finalMessage } : {}),
        ...(result.totalTokens !== undefined ? { total_tokens: result.totalTokens } : {}),
        ...(error !== null ? { error } : {}),
        permission_denials: result.approvalRequired ?? [],
    });
}

export async function writeHeadlessEvent(event: StreamingEvent): Promise<void> {
    let payload: Record<string, unknown>;
    switch (event.name) {
        case 'approval:request':
            payload = { type: 'approval_required', ...toHeadlessApprovalRequired(event) };
            break;
        case 'llm:chunk':
            payload = { type: 'message_delta', content: event.content };
            break;
        case 'llm:retrying':
            if (event.reason !== 'empty_response') return;
            // Discard deltas for the current response; completed responses remain intact.
            payload = { type: 'message_reset', reason: event.reason };
            break;
        case 'llm:tool-call':
            payload = {
                type: 'tool_call',
                tool_name: event.toolName,
                args: event.args,
                ...(event.callId ? { call_id: event.callId } : {}),
            };
            break;
        case 'llm:tool-result':
            payload = {
                type: 'tool_result',
                tool_name: event.toolName,
                success: event.success,
                ...(event.callId ? { call_id: event.callId } : {}),
                ...(!event.success && event.error ? { error: event.error } : {}),
            };
            break;
        case 'llm:unsupported-input':
            payload = { type: 'warning', errors: event.errors };
            break;
        case 'llm:error':
            payload = {
                type: 'run_error',
                recoverable: event.recoverable,
                error: event.error.message,
            };
            break;
        case 'llm:response':
            payload = { type: 'response', content: event.content };
            break;
        default:
            return;
    }
    await writeJsonLineToStdout(payload);
}

function writeJsonLineToStdout(payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
        process.stdout.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}
