import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerSessionCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    const sessionCommand = program.command('session').description('Manage chat sessions');

    sessionCommand
        .command('list')
        .description('List all sessions')
        .action(
            withAnalytics('session list', async () => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionListCommand } = await import('../session-commands.js');
                    await handleSessionListCommand(agent);
                    safeExit('session list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto session list command failed: ${err}`);
                    safeExit('session list', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );

    sessionCommand
        .command('history')
        .description('Show session history')
        .argument('[sessionId]', 'Session ID (defaults to current session)')
        .action(
            withAnalytics('session history', async (sessionId: string) => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionHistoryCommand } = await import('../session-commands.js');
                    await handleSessionHistoryCommand(agent, sessionId);
                    safeExit('session history', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto session history command failed: ${err}`);
                    safeExit('session history', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );

    sessionCommand
        .command('delete')
        .description('Delete a session')
        .argument('<sessionId>', 'Session ID to delete')
        .action(
            withAnalytics('session delete', async (sessionId: string) => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionDeleteCommand } = await import('../session-commands.js');
                    await handleSessionDeleteCommand(agent, sessionId);
                    safeExit('session delete', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto session delete command failed: ${err}`);
                    safeExit('session delete', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );
}
