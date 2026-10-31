import { dextoGateway } from '@dexto/agent-management';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import { openBrowserUrl } from '../../auth/browser-launch.js';
import { DEXTO_CREDITS_URL } from '../../auth/constants.js';
import { CommandError } from '../auth/sign-in-commands.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerBillingCommand({ program }: RuntimeCommandRegisterContext): void {
    program
        .command('billing')
        .description('Show billing status and credit balance')
        .option('--buy', 'Open the page to buy Dexto credits')
        .action(
            withAnalytics('billing', async (options: { buy?: boolean }) => {
                try {
                    const { showBillingStatus } = await import('./status.js');
                    await showBillingStatus({
                        read: () =>
                            dextoGateway.dextoBillingSummary(
                                dextoGateway.defaultDextoGatewayOptions()
                            ),
                        print: (text) => process.stdout.write(`${text}\n`),
                    });
                    if (options.buy) {
                        process.stderr.write(`Buy credits at ${DEXTO_CREDITS_URL}\n`);
                        await openBrowserUrl(DEXTO_CREDITS_URL).catch(() => undefined);
                    }
                    safeExit('billing', 0);
                } catch (error) {
                    if (error instanceof ExitSignal) throw error;
                    process.stderr.write(
                        `${error instanceof Error ? error.message : String(error)}\n`
                    );
                    safeExit(
                        'billing',
                        error instanceof CommandError ? error.exitCode : 1,
                        'error'
                    );
                }
            })
        );
}
