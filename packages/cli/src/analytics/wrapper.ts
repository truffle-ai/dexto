// packages/cli/src/analytics/wrapper.ts
import { onCommandStart, onCommandEnd, capture } from './index.js';
import { COMMAND_TIMEOUT_MS } from './constants.js';
import type {
    CliCommandEndEvent,
    CommandArgsMeta,
    SanitizedOptionValue,
    CliCommandTimeoutEvent,
} from './events.js';

function sanitizeOptions(obj: Record<string, unknown>): Record<string, SanitizedOptionValue> {
    const redactedKeys = /key|token|secret|password|api[_-]?key|authorization|auth/i;
    const truncate = (s: string, max = 256) => (s.length > max ? s.slice(0, max) + '…' : s);
    const out: Record<string, SanitizedOptionValue> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            out[k] = redactedKeys.test(k) ? '[REDACTED]' : truncate(v);
        } else if (Array.isArray(v)) {
            out[k] = { type: 'array', length: v.length };
        } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
            out[k] = v as SanitizedOptionValue;
        } else if (typeof v === 'object' && v) {
            out[k] = { type: 'object' };
        } else {
            out[k] = String(v ?? 'unknown');
        }
    }
    return out;
}

function buildArgsPayload(args: unknown[]): CommandArgsMeta {
    const meta: CommandArgsMeta = {
        argTypes: args.map((a) => (Array.isArray(a) ? 'array' : typeof a)),
    };

    if (args.length > 0 && Array.isArray(args[0])) {
        const list = (args[0] as unknown[]).map((x) => String(x));
        const trimmed = list.map((s) => (s.length > 512 ? s.slice(0, 512) + '…' : s)).slice(0, 10);
        meta.positionalRaw = trimmed;
        meta.positionalCount = list.length;
    }

    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
        meta.optionKeys = Object.keys(last as Record<string, unknown>);
        meta.options = sanitizeOptions(last as Record<string, unknown>);
    }
    return meta;
}

export function withAnalytics<A extends unknown[], R = unknown>(
    commandName: string,
    handler: (...args: A) => Promise<R> | R,
    opts?: { timeoutMs?: number }
): (...args: A) => Promise<R> {
    const timeoutMs = opts?.timeoutMs ?? COMMAND_TIMEOUT_MS;
    return async (...args: A): Promise<R> => {
        const argsMeta = buildArgsPayload(args as unknown[]);
        await onCommandStart(commandName, { args: argsMeta });
        const timeout =
            timeoutMs > 0
                ? (() => {
                      const t = setTimeout(() => {
                          try {
                              const payload: CliCommandTimeoutEvent = {
                                  name: commandName,
                                  phase: 'timeout',
                                  timeoutMs,
                                  args: argsMeta,
                              };
                              capture('dexto_cli_command', payload);
                          } catch {
                              // Timeout instrumentation must never throw.
                          }
                      }, timeoutMs);
                      // Prevent timeout from keeping process alive
                      t.unref();
                      return t;
                  })()
                : null;
        try {
            const result = await handler(...args);
            const success = (typeof process.exitCode === 'number' ? process.exitCode : 0) === 0;
            await onCommandEnd(commandName, success, { args: argsMeta });
            return result as R;
        } catch (err) {
            if (err instanceof ExitSignal) {
                const exitCode = err.code ?? 0;
                process.exitCode = exitCode;
                try {
                    const endMeta: Partial<
                        Omit<CliCommandEndEvent, 'name' | 'phase' | 'success' | 'durationMs'>
                    > & { args: CommandArgsMeta } = { args: argsMeta };
                    if (typeof err.reason === 'string') {
                        endMeta.reason = err.reason;
                    }
                    if (err.commandName) {
                        endMeta.command = err.commandName;
                    }
                    await onCommandEnd(commandName, exitCode === 0, endMeta);
                } catch {
                    // Ignore analytics errors when propagating ExitSignal.
                }
                // Actually exit the process after analytics
                process.exit(exitCode);
            }
            try {
                await onCommandEnd(commandName, false, {
                    error: err instanceof Error ? err.message : String(err),
                    args: argsMeta,
                });
            } catch {
                // Ignore analytics errors when recording failures.
            }
            throw err;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    };
}

export class ExitSignal extends Error {
    code: number;
    reason?: string | undefined;
    commandName?: string | undefined;
    constructor(code: number = 0, reason?: string, commandName?: string) {
        super('ExitSignal');
        this.name = 'ExitSignal';
        this.code = code;
        this.reason = reason;
        this.commandName = commandName;
    }
}

export function safeExit(commandName: string, code: number = 0, reason?: string): never {
    throw new ExitSignal(code, reason, commandName);
}
