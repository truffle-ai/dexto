// packages/cli/src/analytics/wrapper.ts
import { onCommandStart, onCommandEnd, capture } from './index.js';
import { COMMAND_TIMEOUT_MS } from './constants.js';

export function withAnalytics<A extends unknown[], R = unknown>(
    commandName: string,
    handler: (...args: A) => Promise<R> | R,
    opts?: { timeoutMs?: number }
): (...args: A) => Promise<R> {
    const timeoutMs = opts?.timeoutMs ?? COMMAND_TIMEOUT_MS;
    return async (...args: A): Promise<R> => {
        onCommandStart(commandName);
        const timeout = setTimeout(() => {
            try {
                capture('dexto_cli_command', { name: commandName, phase: 'timeout', timeoutMs });
            } catch {}
        }, timeoutMs);
        try {
            const result = await handler(...args);
            await onCommandEnd(commandName, true);
            return result as R;
        } catch (err) {
            try {
                await onCommandEnd(commandName, false, {
                    error: err instanceof Error ? err.message : String(err),
                });
            } catch {}
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    };
}

export function safeExit(commandName: string, code: number = 0, reason?: string): never {
    try {
        void onCommandEnd(commandName, code === 0, { reason });
    } catch {}
    // eslint-disable-next-line no-process-exit
    process.exit(code);
}
