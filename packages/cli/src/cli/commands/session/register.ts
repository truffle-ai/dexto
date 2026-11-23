import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { BootstrapAgentMode, RuntimeCommandRegisterContext } from '../register-context.js';
import { HELD_COMMANDS } from '../../cloud/held-commands.js';

const LOCAL_AGENT_MODES: Readonly<Record<string, BootstrapAgentMode>> = {
    move: 'non-interactive',
    list: 'headless-run',
};

export function registerSessionCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    const chatCommand = program.command('chat').description('Your local and cloud chats');

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
        list: "List your cloud chats, or this machine's with --local",
        follow: "Follow a cloud chat's events until it finishes",
        send: 'Message a cloud chat, steering its current turn or queued after it',
        cancel: "Stop a cloud chat's current run",
        get: "Read a cloud chat's status and messages",
        models: 'List the models your cloud chats can use',
        outputs: 'List the files and resources a cloud chat produced',
        computers: 'List your connected computers for a cloud chat',
        'browser-profiles': 'List your browser profiles for a cloud chat',
        share: 'Set who in your organization can open one of your cloud chats',
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
                    // chat move and chat list --local read this machine's chats through the local
                    // agent; a list runs it silent so its --json stays parseable.
                    const localMode = LOCAL_AGENT_MODES[word];
                    const host =
                        localMode !== undefined
                            ? {
                                  ...cloudHost,
                                  openLocalAgent: async () => {
                                      local.agent ??= await bootstrapAgentFromGlobalOpts({
                                          mode: localMode,
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
