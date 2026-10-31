import { dextoGateway } from '@dexto/agent-management';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';
import { CommandError } from '../auth/sign-in-commands.js';

export function registerModelsCommand({ program }: RuntimeCommandRegisterContext): void {
    program
        .command('models')
        .description('Models Dexto serves on your sign-in')
        .command('list')
        .description('List the models Dexto serves, as dexto/<model>')
        .action(
            withAnalytics('models list', async () => {
                try {
                    const { listDextoModels } = await import('./list.js');
                    await listDextoModels({
                        read: () =>
                            dextoGateway.dextoModels(dextoGateway.defaultDextoGatewayOptions()),
                        print: (text) => process.stdout.write(`${text}\n`),
                    });
                    safeExit('models list', 0);
                } catch (error) {
                    if (error instanceof ExitSignal) throw error;
                    process.stderr.write(
                        `${error instanceof Error ? error.message : String(error)}\n`
                    );
                    safeExit(
                        'models list',
                        error instanceof CommandError ? error.exitCode : 1,
                        'error'
                    );
                }
            })
        );
}
