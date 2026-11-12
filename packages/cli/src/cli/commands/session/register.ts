import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';
import { HELD_COMMANDS } from '../../cloud/held-commands.js';

export function registerSessionCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    const chatCommand = program.command('chat').description('Your local and cloud chats');

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

    // The cloud command engine owns these verbs and their options; analytics records only names.
    for (const [word, description] of Object.entries({
        local: 'List Claude Code and Codex chats on this machine that Dexto can import',
        import: 'Import Claude Code or Codex chats into Dexto',
        start: 'Start a cloud chat on your chosen connected computer and browser profile',
        computers: 'List your connected computers for a cloud chat',
        'browser-profiles': 'List your browser profiles for a cloud chat',
        move: 'Move a synced chat and its working tree to cloud or local',
        watch: 'Stay attached to a chat on its cloud computer',
    }).filter(([word]) => !HELD_COMMANDS.has(`chat ${word}`)))
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
                    const controller = new AbortController();
                    const stop = () => controller.abort();
                    process.once('SIGINT', stop);
                    const local: {
                        agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null;
                    } = { agent: null };
                    const cloudHost = nodeCloudHost(controller.signal);
                    const host =
                        word === 'move'
                            ? {
                                  ...cloudHost,
                                  openLocalAgent: async () => {
                                      local.agent ??= await bootstrapAgentFromGlobalOpts({
                                          mode: 'non-interactive',
                                      });
                                      return local.agent;
                                  },
                              }
                            : cloudHost;
                    let code: number;
                    try {
                        code = await runCloud(host, ['chat', word, ...args]);
                    } finally {
                        process.removeListener('SIGINT', stop);
                        if (local.agent !== null) await local.agent.stop();
                    }
                    safeExit(`chat ${word}`, code);
                })();
            });
}
