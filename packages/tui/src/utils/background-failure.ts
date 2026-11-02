import type { Message } from '../state/types.js';

/**
 * A background command's failure, read back by `bash_output`. Reading it succeeds as a tool call,
 * so its outcome is only in the result.
 */
export function backgroundFailure(toolName: string, rawResult: unknown): Partial<Message> {
    if (toolName !== 'bash_output' || typeof rawResult !== 'object' || rawResult === null) {
        return {};
    }
    const { status, stderr, stdout, exit_code: exitCode } = rawResult as Record<string, unknown>;
    if (status !== 'failed') return {};
    const output = [stderr, stdout].find(
        (text): text is string => typeof text === 'string' && text.trim().length > 0
    );
    return {
        toolOutcome: 'failed',
        toolFailureText: output ?? `exit ${String(exitCode ?? 'unknown')}`,
    };
}

/**
 * The same failure in a resumed chat, where only the result's stored text remains. Text that
 * isn't valid JSON (a large result is stored cut down) reports nothing, so that row stays as is.
 */
export function storedBackgroundFailure(toolName: string, storedText: string): Partial<Message> {
    if (toolName !== 'bash_output') return {};
    try {
        return backgroundFailure(toolName, JSON.parse(storedText));
    } catch {
        return {};
    }
}
