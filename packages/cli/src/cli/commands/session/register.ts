import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerSessionCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    const chatCommand = program
        .command('chat')
        .description("Your chats: this machine's sessions, and other agents' chats into Dexto");

    chatCommand
        .command('list')
        .description("List this machine's chats")
        .action(
            withAnalytics('chat list', async () => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionListCommand } = await import('../session-commands.js');
                    await handleSessionListCommand(agent);
                    safeExit('chat list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto chat list command failed: ${err}`);
                    safeExit('chat list', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );

    chatCommand
        .command('history')
        .description("Show a chat's messages")
        .argument('[sessionId]', 'The chat (default: the current one)')
        .action(
            withAnalytics('chat history', async (sessionId: string) => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionHistoryCommand } = await import('../session-commands.js');
                    await handleSessionHistoryCommand(agent, sessionId);
                    safeExit('chat history', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto chat history command failed: ${err}`);
                    safeExit('chat history', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );

    chatCommand
        .command('delete')
        .description('Delete a chat')
        .argument('<sessionId>', 'The chat to delete')
        .action(
            withAnalytics('chat delete', async (sessionId: string) => {
                let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null = null;
                try {
                    agent = await bootstrapAgentFromGlobalOpts({ mode: 'non-interactive' });

                    const { handleSessionDeleteCommand } = await import('../session-commands.js');
                    await handleSessionDeleteCommand(agent, sessionId);
                    safeExit('chat delete', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto chat delete command failed: ${err}`);
                    safeExit('chat delete', 1, 'error');
                } finally {
                    if (agent) {
                        await agent.stop().catch(() => {});
                    }
                }
            })
        );

    // Claude Code and Codex chats on this machine, and importing them into Dexto, run on the
    // cloud command engine with its own options; analytics records only the command name.
    for (const [word, description] of [
        ['local', 'List Claude Code and Codex chats on this machine that Dexto can import'],
        ['import', 'Import Claude Code or Codex chats into Dexto'],
    ] as const)
        chatCommand
            .command(word)
            .description(description)
            .helpOption(false)
            .passThroughOptions()
            .allowUnknownOption()
            .allowExcessArguments()
            .argument('[args...]')
            .action(async (args: string[]) => {
                await withAnalytics(`chat ${word}`, async () => {
                    const [{ runCloud }, { nodeCloudHost }] = await Promise.all([
                        import('../../cloud/run.js'),
                        import('../../cloud/host.js'),
                    ]);
                    const code = await runCloud(nodeCloudHost(new AbortController().signal), [
                        'chat',
                        word,
                        ...args,
                    ]);
                    safeExit(`chat ${word}`, code);
                })();
            });
}
