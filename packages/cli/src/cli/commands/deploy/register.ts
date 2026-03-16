import type { Command } from 'commander';
import { ExitSignal, safeExit, withAnalytics } from '../../../analytics/wrapper.js';

export interface DeployCommandRegisterContext {
    program: Command;
}

export function registerDeployCommand({ program }: DeployCommandRegisterContext): void {
    const deployCommand = program
        .command('deploy')
        .description('Deploy the current workspace to a cloud sandbox');

    deployCommand.addHelpText(
        'after',
        `
Examples:
  $ dexto deploy
  $ dexto deploy status
  $ dexto deploy stop
  $ dexto deploy delete
`
    );

    deployCommand.option('--no-interactive', 'Disable interactive prompts').action(
        withAnalytics('deploy', async (options: { interactive?: boolean }) => {
            try {
                const { handleDeployCommand } = await import('./index.js');
                await handleDeployCommand(options);
                safeExit('deploy', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto deploy command failed: ${err}`);
                safeExit('deploy', 1, 'error');
            }
        })
    );

    deployCommand
        .command('status')
        .description('Show the linked cloud deployment for the current workspace')
        .action(
            withAnalytics('deploy status', async () => {
                try {
                    const { handleDeployStatusCommand } = await import('./index.js');
                    await handleDeployStatusCommand();
                    safeExit('deploy status', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto deploy status command failed: ${err}`);
                    safeExit('deploy status', 1, 'error');
                }
            })
        );

    deployCommand
        .command('stop')
        .description('Stop the linked cloud sandbox for the current workspace')
        .action(
            withAnalytics('deploy stop', async () => {
                try {
                    const { handleDeployStopCommand } = await import('./index.js');
                    await handleDeployStopCommand();
                    safeExit('deploy stop', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto deploy stop command failed: ${err}`);
                    safeExit('deploy stop', 1, 'error');
                }
            })
        );

    deployCommand
        .command('delete')
        .description('Delete the linked cloud deployment and unlink this workspace')
        .option('--no-interactive', 'Disable confirmation prompts')
        .action(
            withAnalytics('deploy delete', async (options: { interactive?: boolean }) => {
                try {
                    const { handleDeployDeleteCommand } = await import('./index.js');
                    await handleDeployDeleteCommand(options);
                    safeExit('deploy delete', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto deploy delete command failed: ${err}`);
                    safeExit('deploy delete', 1, 'error');
                }
            })
        );
}
