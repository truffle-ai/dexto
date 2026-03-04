import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerBillingCommand({ program }: RuntimeCommandRegisterContext): void {
    program
        .command('billing')
        .description('Show billing status and credit balance')
        .option('--buy', 'Open Dexto Nova credits purchase page')
        .action(
            withAnalytics('billing', async (options: { buy?: boolean }) => {
                try {
                    const { handleBillingStatusCommand } = await import('./status.js');
                    await handleBillingStatusCommand(options);
                    safeExit('billing', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto billing command failed: ${err}`);
                    safeExit('billing', 1, 'error');
                }
            })
        );
}
