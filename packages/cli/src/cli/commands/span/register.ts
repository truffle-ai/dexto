import type { Command } from 'commander';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';

export interface SpanCommandRegisterContext {
    program: Command;
}

export function registerSpanCommand({ program }: SpanCommandRegisterContext): void {
    const span = program.command('span').description('Inspect hosted run spans from Dexto Cloud');

    span.command('list <runId>')
        .description('List spans for a hosted run')
        .option('--json', 'Print the raw span list response as JSON')
        .option('--limit <count>', 'Maximum number of spans to return')
        .option('--name <spanName>', 'Filter to an exact span name')
        .option('--platform-url <url>', 'Use a custom Dexto platform URL')
        .option('--sort <sort>', 'Sort by started_at or duration')
        .option('--status <status>', 'Filter to a span status')
        .action(
            withAnalytics('span:list', async (runId: string, options) => {
                try {
                    const { handleSpanListCommand } = await import('../trace/index.js');
                    await handleSpanListCommand(runId, options);
                    safeExit('span:list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto span list command failed: ${err}`);
                    safeExit('span:list', 1, 'error');
                }
            })
        );
}
