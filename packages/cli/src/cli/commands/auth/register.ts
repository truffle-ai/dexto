import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerAuthCommand({ program }: RuntimeCommandRegisterContext): void {
    const authCommand = program.command('auth').description('Manage authentication');

    authCommand
        .command('login')
        .description('Login to Dexto')
        .option('--api-key <key>', 'Use Dexto API key instead of device-code login')
        .option('--token <token>', 'Use an existing Supabase access token')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics(
                'auth login',
                async (options: { apiKey?: string; token?: string; interactive?: boolean }) => {
                    try {
                        const { handleLoginCommand } = await import('./login.js');
                        await handleLoginCommand(options);
                        safeExit('auth login', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto auth login command failed: ${err}`);
                        safeExit('auth login', 1, 'error');
                    }
                }
            )
        );

    authCommand
        .command('logout')
        .description('Logout from Dexto')
        .option('--force', 'Skip confirmation prompt')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics(
                'auth logout',
                async (options: { force?: boolean; interactive?: boolean }) => {
                    try {
                        const { handleLogoutCommand } = await import('./logout.js');
                        await handleLogoutCommand(options);
                        safeExit('auth logout', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto auth logout command failed: ${err}`);
                        safeExit('auth logout', 1, 'error');
                    }
                }
            )
        );

    authCommand
        .command('status')
        .description('Show authentication status')
        .action(
            withAnalytics('auth status', async () => {
                try {
                    const { handleStatusCommand } = await import('./status.js');
                    await handleStatusCommand();
                    safeExit('auth status', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto auth status command failed: ${err}`);
                    safeExit('auth status', 1, 'error');
                }
            })
        );

    program
        .command('login')
        .description('Login to Dexto (alias for `dexto auth login`)')
        .option('--api-key <key>', 'Use Dexto API key instead of device-code login')
        .option('--token <token>', 'Use an existing Supabase access token')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics(
                'login',
                async (options: { apiKey?: string; token?: string; interactive?: boolean }) => {
                    try {
                        const { handleLoginCommand } = await import('./login.js');
                        await handleLoginCommand(options);
                        safeExit('login', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto login command failed: ${err}`);
                        safeExit('login', 1, 'error');
                    }
                }
            )
        );

    program
        .command('logout')
        .description('Logout from Dexto (alias for `dexto auth logout`)')
        .option('--force', 'Skip confirmation prompt')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics('logout', async (options: { force?: boolean; interactive?: boolean }) => {
                try {
                    const { handleLogoutCommand } = await import('./logout.js');
                    await handleLogoutCommand(options);
                    safeExit('logout', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto logout command failed: ${err}`);
                    safeExit('logout', 1, 'error');
                }
            })
        );
}
