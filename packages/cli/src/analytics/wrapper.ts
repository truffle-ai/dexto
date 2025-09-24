// packages/cli/src/analytics/wrapper.ts
import { onCommandStart, onCommandEnd, capture, Properties } from './index.js';
import { COMMAND_TIMEOUT_MS } from './constants.js';

/**
 * Redact potentially sensitive option values (e.g., keys, tokens, prompts).
 *
 * - String values are fully redacted to avoid accidental leakage.
 * - Arrays/objects are summarized to shapes to keep analytics light and safe.
 */
function sanitizeOptions(obj: Record<string, unknown>): Record<string, unknown> {
    const redactedKeys = /key|token|secret|password|prompt/i;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            out[k] = redactedKeys.test(k) ? '[REDACTED]' : '[REDACTED]';
        } else if (Array.isArray(v)) {
            out[k] = { type: 'array', length: v.length };
        } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
            out[k] = v;
        } else if (typeof v === 'object' && v) {
            out[k] = { type: 'object' };
        } else {
            out[k] = typeof v;
        }
    }
    return out;
}

/**
 * Convert command arguments into a compact, privacy-safe metadata payload.
 *
 * Captures:
 * - argTypes: basic JS types of each argument
 * - positionalCount: count of positional strings (first arg array)
 * - optionKeys: keys present in the last object-like argument
 * - options: sanitized summary of option values
 */
function buildArgsMeta(args: unknown[]): Properties {
    const meta: Properties = { argTypes: args.map((a) => (Array.isArray(a) ? 'array' : typeof a)) };
    if (args.length > 0 && Array.isArray(args[0])) {
        meta.positionalCount = (args[0] as unknown[]).length;
    }
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
        meta.optionKeys = Object.keys(last as Record<string, unknown>);
        meta.options = sanitizeOptions(last as Record<string, unknown>);
    }
    return meta;
}

/**
 * Wrap a Commander action with analytics timing, argument metadata,
 * timeout notice, and completion events.
 *
 * Usage:
 *   program.command('install')
 *     .action(withAnalytics('install', async (agents: string[], opts: Options) => { ... }));
 */
export function withAnalytics<A extends unknown[], R = unknown>(
    commandName: string,
    handler: (...args: A) => Promise<R> | R,
    opts?: { timeoutMs?: number }
): (...args: A) => Promise<R> {
    const timeoutMs = opts?.timeoutMs ?? COMMAND_TIMEOUT_MS;
    return async (...args: A): Promise<R> => {
        const argsMeta = buildArgsMeta(args as unknown[]);
        onCommandStart(commandName, { args: argsMeta });
        const timeout = setTimeout(() => {
            try {
                capture('dexto_cli_command', {
                    name: commandName,
                    phase: 'timeout',
                    timeoutMs,
                    args: argsMeta,
                });
            } catch {}
        }, timeoutMs);
        try {
            const result = await handler(...args);
            await onCommandEnd(commandName, true, { args: argsMeta });
            return result as R;
        } catch (err) {
            try {
                await onCommandEnd(commandName, false, {
                    error: err instanceof Error ? err.message : String(err),
                    args: argsMeta,
                });
            } catch {}
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    };
}

/**
 * Emit a final completion event for the given command and exit the process.
 * Use this instead of process.exit inside command handlers.
 */
export function safeExit(commandName: string, code: number = 0, reason?: string): never {
    try {
        void onCommandEnd(commandName, code === 0, { reason });
    } catch {}
    // eslint-disable-next-line no-process-exit
    process.exit(code);
}
