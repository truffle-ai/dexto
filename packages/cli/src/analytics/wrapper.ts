// packages/cli/src/analytics/wrapper.ts
import { COMMAND_TIMEOUT_MS } from './constants.js';
import type { CliCommandEndEvent, CommandArgsMeta, CliCommandTimeoutEvent } from './events.js';

type AnalyticsModule = typeof import('./index.js');
let analyticsModulePromise: Promise<AnalyticsModule> | null = null;
let analyticsInitialized = false;

async function getAnalyticsModule(): Promise<AnalyticsModule> {
    if (!analyticsModulePromise) {
        analyticsModulePromise = import('./index.js');
    }
    return analyticsModulePromise;
}

async function ensureAnalyticsInitialized(): Promise<AnalyticsModule> {
    const analytics = await getAnalyticsModule();
    if (!analyticsInitialized) {
        await analytics.initAnalytics({ appVersion: process.env.DEXTO_CLI_VERSION || '0.0.0' });
        analyticsInitialized = true;
    }
    return analytics;
}

export function buildArgsPayload(args: unknown[]): CommandArgsMeta {
    const meta: CommandArgsMeta = {
        argTypes: args.map((arg) => (Array.isArray(arg) ? 'array' : typeof arg)),
    };
    if (Array.isArray(args[0])) {
        meta.positionalCount = args[0].length;
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
        let analytics: AnalyticsModule | null = null;
        try {
            analytics = await ensureAnalyticsInitialized();
            await analytics.onCommandStart(commandName, { args: argsMeta });
        } catch {
            analytics = null;
        }
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
                              if (analytics) {
                                  analytics.capture('dexto_cli_command', payload);
                                  return;
                              }
                              void getAnalyticsModule()
                                  .then((mod) => mod.capture('dexto_cli_command', payload))
                                  .catch(() => {});
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
            if (analytics) {
                await analytics.onCommandEnd(commandName, success, { args: argsMeta });
            }
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
                    if (analytics) {
                        await analytics.onCommandEnd(commandName, exitCode === 0, endMeta);
                    }
                } catch {
                    // Ignore analytics errors when propagating ExitSignal.
                }
                // Actually exit the process after analytics
                process.exit(exitCode);
            }
            try {
                if (analytics) {
                    await analytics.onCommandEnd(commandName, false, {
                        args: argsMeta,
                    });
                }
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
