import { ApprovalType, type ApprovalRequest, type StreamingEvent } from '@dexto/core';
import { HEADLESS_APPROVAL_MESSAGE } from '../../approval/headless-approval-handler.js';
import type { HeadlessRunResult } from './headless.js';

export type HeadlessOutputFormat = 'text' | 'json' | 'jsonl';

export type HeadlessApprovalRequired = {
    approvalId: string;
    sessionId?: string;
    message: string;
} & (
    | { approvalType: typeof ApprovalType.TOOL_APPROVAL; toolName: string; toolCallId: string }
    | { approvalType: typeof ApprovalType.COMMAND_APPROVAL; toolName: string }
    | {
          approvalType: Exclude<
              ApprovalRequest['type'],
              typeof ApprovalType.TOOL_APPROVAL | typeof ApprovalType.COMMAND_APPROVAL
          >;
      }
);

export function toHeadlessApprovalRequired(request: ApprovalRequest): HeadlessApprovalRequired {
    const correlation = {
        approvalId: request.approvalId,
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
        message: HEADLESS_APPROVAL_MESSAGE,
    };
    switch (request.type) {
        case ApprovalType.TOOL_APPROVAL:
            return {
                ...correlation,
                approvalType: request.type,
                toolName: request.metadata.toolName,
                toolCallId: request.metadata.toolCallId,
            };
        case ApprovalType.COMMAND_APPROVAL:
            return {
                ...correlation,
                approvalType: request.type,
                toolName: request.metadata.toolName,
            };
        default:
            return { ...correlation, approvalType: request.type };
    }
}

export async function writeHeadlessResult(
    format: HeadlessOutputFormat,
    result: HeadlessRunResult,
    sessionId: string | undefined
): Promise<void> {
    if (format === 'text') return;
    await writeJsonLineToStdout({
        version: 1,
        ...(format === 'json'
            ? { status: result.fatalError ? 'failed' : 'completed' }
            : { type: result.fatalError ? 'error' : 'complete' }),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(result.finalMessage !== undefined ? { content: result.finalMessage } : {}),
        ...(result.totalTokens !== undefined ? { totalTokens: result.totalTokens } : {}),
        ...(result.fatalError ? { error: result.fatalError.message } : {}),
        ...(result.approvalRequired?.length ? { approvalRequired: result.approvalRequired } : {}),
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
        case 'llm:tool-call':
            payload = {
                type: 'tool_call',
                toolName: event.toolName,
                args: event.args,
                ...(event.callId ? { callId: event.callId } : {}),
            };
            break;
        case 'llm:tool-result':
            payload = {
                type: 'tool_result',
                toolName: event.toolName,
                success: event.success,
                ...(event.callId ? { callId: event.callId } : {}),
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
    await writeJsonLineToStdout({ version: 1, ...payload });
}

function writeJsonLineToStdout(payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
        process.stdout.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}
