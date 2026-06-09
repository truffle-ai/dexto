import type { Command } from 'commander';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';

export interface TraceCommandRegisterContext {
    program: Command;
}

interface TraceCommonOptions {
    json?: boolean | undefined;
    platformUrl?: string | undefined;
}

export function registerTraceCommand({ program }: TraceCommandRegisterContext): void {
    const trace = program
        .command('trace [runId]')
        .description('Discover and fetch hosted run traces from Dexto Cloud')
        .option('--json', 'Print the raw trace response as JSON')
        .option('--platform-url <url>', 'Use a custom Dexto platform URL')
        .action(
            withAnalytics('trace', async (runId: string, options: TraceCommonOptions) => {
                try {
                    if (!runId) {
                        trace.help();
                        return;
                    }
                    const { handleTraceCommand } = await import('./index.js');
                    await handleTraceCommand(runId, options);
                    safeExit('trace', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto trace command failed: ${err}`);
                    safeExit('trace', 1, 'error');
                }
            })
        );

    trace
        .command('list')
        .description('List recent hosted run traces')
        .option('--json', 'Print the raw trace list response as JSON')
        .option('--limit <count>', 'Maximum number of traces to return')
        .option('--period <period>', 'Filter to a recent period such as 15m, 3h, or 7d')
        .option('--platform-url <url>', 'Use a custom Dexto platform URL')
        .option('--session <sessionId>', 'Filter to a session id')
        .option('--status <status>', 'Filter to a run status')
        .action(
            withAnalytics('trace:list', async (options) => {
                try {
                    const { handleTraceListCommand } = await import('./index.js');
                    await handleTraceListCommand({
                        ...trace.opts<TraceCommonOptions>(),
                        ...options,
                    });
                    safeExit('trace:list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto trace list command failed: ${err}`);
                    safeExit('trace:list', 1, 'error');
                }
            })
        );

    trace
        .command('view <runId>')
        .description('Fetch one hosted run trace')
        .option('--json', 'Print the raw trace response as JSON')
        .option('--platform-url <url>', 'Use a custom Dexto platform URL')
        .action(
            withAnalytics('trace:view', async (runId: string, options: TraceCommonOptions) => {
                try {
                    const { handleTraceViewCommand } = await import('./index.js');
                    await handleTraceViewCommand(runId, {
                        ...trace.opts<TraceCommonOptions>(),
                        ...options,
                    });
                    safeExit('trace:view', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto trace view command failed: ${err}`);
                    safeExit('trace:view', 1, 'error');
                }
            })
        );
}
